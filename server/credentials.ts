/* eslint-disable jsdoc/require-jsdoc */
import { createPrivateKey } from 'node:crypto'
import { sql } from 'kysely'
import {
  createGcsExtensionUserError,
  deleteEncryptedExtensionSecret,
  setEncryptedExtensionSecret,
  type GcsExtensionRouteContext
} from '@gcs-ssc/extensions/server'
import {
  GCFORMS_EXTENSION_KEY,
  GcFormsCredentialCreateSchema,
  GcFormsCredentialPatchSchema,
  type GcFormsCredentialCreate,
  type GcFormsCredentialPatch,
  type GcFormsCredentialSummary
} from '../shared/gcforms'
import { asGcFormsIntegrationDb, type GcFormsIntegrationDb } from './db'
import { getGcFormsSecretRootKey } from './runtime'

type ExtensionAuthContext = {
  userAbilities: {
    authorize: (subject: 'agency', action: 'read' | 'update', scope: unknown) => boolean
  }
}

type CredentialRouteContext = GcsExtensionRouteContext

type CredentialRow = {
  id: string | number
  name_en: string
  name_fr: string
  key_id: string
  user_id: string
  form_id: string
  updated_at: Date | string | null
  created_at: Date | string
}

const toCredentialContext = (contextOrEvent: CredentialRouteContext | {
  context: {
    $authContext?: unknown
    $db: unknown
    params?: Record<string, string | undefined>
  }
}): CredentialRouteContext => {
  if ('params' in contextOrEvent && 'db' in contextOrEvent) {
    return contextOrEvent
  }

  const event = contextOrEvent
  return {
    event,
    db: event.context.$db,
    params: event.context.params ?? {},
    auth: event.context.$authContext as never,
    config: {},
    readBody: async () => {
      throw new Error('Request body is not available on this test credential context.')
    },
    getHeader: () => undefined
  } as CredentialRouteContext
}

const getAgencyId = (context: CredentialRouteContext): string => context.params.agencyId ?? ''

const authorizeGcFormsAgencyCredentials = (
  context: CredentialRouteContext,
  agencyId: string,
  action: 'read' | 'update'
) => {
  if (!agencyId) {
    throw createGcsExtensionUserError({
      statusCode: 400,
      code: 'GCS_GCFORMS_AGENCY_MISSING',
      message: {
        en: 'Agency id is required to manage GC Forms credentials.',
        fr: 'L identifiant de l organisation est requis pour gerer les justificatifs GC Forms.'
      }
    })
  }

  const authContext = context.auth as ExtensionAuthContext | undefined
  if (!authContext) {
    throw createGcsExtensionUserError({
      statusCode: 401,
      code: 'GCS_GCFORMS_UNAUTHORIZED',
      message: {
        en: 'You must be signed in to manage GC Forms credentials.',
        fr: 'Vous devez ouvrir une session pour gerer les justificatifs GC Forms.'
      }
    })
  }

  if (!authContext.userAbilities.authorize('agency', action, { type: 'agency', agencyId })) {
    throw createGcsExtensionUserError({
      statusCode: 403,
      code: 'GCS_GCFORMS_FORBIDDEN',
      message: {
        en: 'You do not have access to manage GC Forms credentials for this agency.',
        fr: 'Vous n avez pas acces a la gestion des justificatifs GC Forms pour cette organisation.'
      }
    })
  }
}

const assertValidPrivateKey = (key: string) => {
  try {
    createPrivateKey(key)
  } catch {
    throw createGcsExtensionUserError({
      statusCode: 400,
      code: 'GCS_GCFORMS_PRIVATE_KEY_INVALID',
      message: {
        en: 'The GC Forms private key is not a valid PEM private key.',
        fr: 'La cle privee GC Forms n est pas une cle privee PEM valide.'
      }
    })
  }
}

const toSummary = (row: CredentialRow): GcFormsCredentialSummary => ({
  id: String(row.id),
  name_en: row.name_en,
  name_fr: row.name_fr,
  keyId: row.key_id,
  userId: row.user_id,
  formId: row.form_id,
  updatedAt: row.updated_at instanceof Date
    ? row.updated_at.toISOString()
    : typeof row.updated_at === 'string'
      ? row.updated_at
      : row.created_at instanceof Date
        ? row.created_at.toISOString()
        : typeof row.created_at === 'string'
          ? row.created_at
          : null
})

export const listGcFormsCredentials = async (contextOrEvent: Parameters<typeof toCredentialContext>[0]) => {
  const context = toCredentialContext(contextOrEvent)
  const agencyId = getAgencyId(context)
  authorizeGcFormsAgencyCredentials(context, agencyId, 'read')

  const rows = await asGcFormsIntegrationDb(context.db)
    .selectFrom('extensions.gcs_gcforms_credentials')
    .select(['id', 'name_en', 'name_fr', 'key_id', 'user_id', 'form_id', 'updated_at', 'created_at'])
    .where('agency_id', '=', sql<string>`${agencyId}::bigint`)
    .where('_deleted', '=', false)
    .orderBy('name_en', 'asc')
    .orderBy('id', 'asc')
    .execute()

  const items = rows.map(row => toSummary(row))

  return {
    items,
    total: items.length,
    stats: {
      total: items.length,
      active: items.length
    },
    page: 1,
    limit: items.length || 10
  }
}

const storePrivateKey = async (
  db: GcFormsIntegrationDb,
  agencyId: string,
  credentialId: string,
  key: string
) => {
  await setEncryptedExtensionSecret(db as never, {
    rootKey: getGcFormsSecretRootKey(),
    extensionKey: GCFORMS_EXTENSION_KEY,
    ownerType: 'agency',
    ownerId: agencyId,
    secretKey: credentialId,
    value: { key },
    metadata: { credentialId }
  })
}

export const createGcFormsCredential = async (contextOrEvent: Parameters<typeof toCredentialContext>[0]) => {
  const context = toCredentialContext(contextOrEvent)
  const agencyId = getAgencyId(context)
  authorizeGcFormsAgencyCredentials(context, agencyId, 'update')

  const body = GcFormsCredentialCreateSchema.parse(await context.readBody())
  assertValidPrivateKey(body.key)

  const item = await asGcFormsIntegrationDb(context.db)
    .transaction()
    .execute(async trx => {
      const row = await trx
        .insertInto('extensions.gcs_gcforms_credentials')
        .values({
          agency_id: agencyId,
          name_en: body.name_en,
          name_fr: body.name_fr,
          key_id: body.keyId,
          user_id: body.userId,
          form_id: body.formId
        })
        .returning(['id', 'name_en', 'name_fr', 'key_id', 'user_id', 'form_id', 'updated_at', 'created_at'])
        .executeTakeFirstOrThrow()

      await storePrivateKey(trx, agencyId, String(row.id), body.key)

      return toSummary(row)
    })

  return {
    ok: true,
    item
  }
}

const getActiveCredentialRow = async (
  db: GcFormsIntegrationDb,
  agencyId: string,
  credentialId: string
) => await db
  .selectFrom('extensions.gcs_gcforms_credentials')
  .select(['id', 'name_en', 'name_fr', 'key_id', 'user_id', 'form_id', 'updated_at', 'created_at'])
  .where('id', '=', sql<string>`${credentialId}::bigint`)
  .where('agency_id', '=', sql<string>`${agencyId}::bigint`)
  .where('_deleted', '=', false)
  .executeTakeFirst()

const patchValues = (body: GcFormsCredentialPatch) => {
  const values: Partial<{
    name_en: string
    name_fr: string
    key_id: string
    user_id: string
    form_id: string
    updated_at: Date
  }> = {
    updated_at: new Date()
  }

  if (body.name_en !== undefined) {
    values.name_en = body.name_en
  }
  if (body.name_fr !== undefined) {
    values.name_fr = body.name_fr
  }
  if (body.keyId !== undefined) {
    values.key_id = body.keyId
  }
  if (body.userId !== undefined) {
    values.user_id = body.userId
  }
  if (body.formId !== undefined) {
    values.form_id = body.formId
  }

  return values
}

export const patchGcFormsCredential = async (contextOrEvent: Parameters<typeof toCredentialContext>[0]) => {
  const context = toCredentialContext(contextOrEvent)
  const agencyId = getAgencyId(context)
  const credentialId = context.params.credentialId ?? ''
  authorizeGcFormsAgencyCredentials(context, agencyId, 'update')

  const body = GcFormsCredentialPatchSchema.parse(await context.readBody())
  if (body.key !== undefined) {
    assertValidPrivateKey(body.key)
  }

  const db = asGcFormsIntegrationDb(context.db)
  const existing = await getActiveCredentialRow(db, agencyId, credentialId)
  if (!existing) {
    throw createGcsExtensionUserError({
      statusCode: 404,
      code: 'GCS_GCFORMS_CREDENTIAL_MISSING',
      message: {
        en: 'The selected GC Forms credential is not available on the server.',
        fr: 'Le justificatif GC Forms selectionne n est pas disponible sur le serveur.'
      }
    })
  }

  const item = await db.transaction().execute(async trx => {
    const row = await trx
      .updateTable('extensions.gcs_gcforms_credentials')
      .set(patchValues(body))
      .where('id', '=', sql<string>`${credentialId}::bigint`)
      .where('agency_id', '=', sql<string>`${agencyId}::bigint`)
      .where('_deleted', '=', false)
      .returning(['id', 'name_en', 'name_fr', 'key_id', 'user_id', 'form_id', 'updated_at', 'created_at'])
      .executeTakeFirstOrThrow()

    if (body.key !== undefined) {
      await storePrivateKey(trx, agencyId, credentialId, body.key)
    }

    return toSummary(row)
  })

  return {
    ok: true,
    item
  }
}

export const deleteGcFormsCredential = async (contextOrEvent: Parameters<typeof toCredentialContext>[0]) => {
  const context = toCredentialContext(contextOrEvent)
  const agencyId = getAgencyId(context)
  const credentialId = context.params.credentialId ?? ''
  authorizeGcFormsAgencyCredentials(context, agencyId, 'update')

  const db = asGcFormsIntegrationDb(context.db)
  await db.transaction().execute(async trx => {
    await trx
      .updateTable('extensions.gcs_gcforms_credentials')
      .set({
        _deleted: true,
        updated_at: new Date()
      })
      .where('id', '=', sql<string>`${credentialId}::bigint`)
      .where('agency_id', '=', sql<string>`${agencyId}::bigint`)
      .where('_deleted', '=', false)
      .execute()

    await deleteEncryptedExtensionSecret(
      trx as never,
      GCFORMS_EXTENSION_KEY,
      'agency',
      agencyId,
      credentialId
    )
  })

  return { ok: true }
}

export type { GcFormsCredentialCreate, GcFormsCredentialPatch }
