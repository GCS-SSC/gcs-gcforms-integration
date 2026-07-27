import { createPrivateKey } from 'node:crypto'
import { sql } from 'kysely'
import {
  createGcsExtensionUserError,
  deleteEncryptedExtensionSecret,
  getEncryptedExtensionSecret,
  setEncryptedExtensionSecret,
  type GcsExtensionRouteContext
} from '@gcs-ssc/extensions/server'
import {
  GCFORMS_EXTENSION_KEY,
  GcFormsCredentialCreateSchema,
  GcFormsCredentialPatchSchema,
  GcFormsCredentialSecretSchema,
  type GcFormsCredentialPatch,
  type GcFormsCredentialSummary
} from '../shared/gcforms.ts'
import {
  asGcFormsIntegrationDb,
  type GcFormsIntegrationDatabaseClient,
  type GcFormsIntegrationDb,
  type GcFormsIntegrationHostDatabase
} from './db.ts'
import { getGcFormsSecretRootKey, runAuthorizedGcFormsWrite } from './runtime.ts'

type CredentialRow = {
  id: string
  name_en: string
  name_fr: string
  key_id: string
  user_id: string
  form_id: string
  revision: number
  updated_at: Date | string | null
  created_at: Date | string
}

const getAgencyId = (context: GcsExtensionRouteContext): string => context.params.agencyId ?? ''

/** Verifies that the current user may read or update credentials for the requested agency. */
const authorizeGcFormsAgencyCredentials = (
  context: GcsExtensionRouteContext,
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

  const authContext = context.auth
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

/** Lists active GC Forms credential metadata for an authorized agency without exposing private keys. */
export const listGcFormsCredentials = async (context: GcsExtensionRouteContext) => {
  const agencyId = getAgencyId(context)
  authorizeGcFormsAgencyCredentials(context, agencyId, 'read')

  const rows = await asGcFormsIntegrationDb(context.db)
    .selectFrom('extensions.gcs_gcforms_credentials as credential')
    .innerJoin('Agency_Profile as agency', 'agency.id', 'credential.agency_id')
    .select([
      'credential.id',
      'credential.name_en',
      'credential.name_fr',
      'credential.key_id',
      'credential.user_id',
      'credential.form_id',
      'credential.revision',
      'credential.updated_at',
      'credential.created_at'
    ])
    .where('credential.agency_id', '=', sql<string>`${agencyId}::bigint`)
    .where('credential._deleted', '=', false)
    .where('agency._deleted', '=', false)
    .orderBy('credential.name_en', 'asc')
    .orderBy('credential.id', 'asc')
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
  db: GcFormsIntegrationDatabaseClient,
  agencyId: string,
  credentialId: string,
  key: string
) => {
  await setEncryptedExtensionSecret<GcFormsIntegrationHostDatabase>(db, {
    rootKey: getGcFormsSecretRootKey(),
    extensionKey: GCFORMS_EXTENSION_KEY,
    ownerType: 'agency',
    ownerId: agencyId,
    secretKey: credentialId,
    value: { key },
    metadata: { credentialId }
  })
}

/** Creates credential metadata and stores its validated private key as an encrypted extension secret. */
export const createGcFormsCredential = async (context: GcsExtensionRouteContext) => {
  const agencyId = getAgencyId(context)
  authorizeGcFormsAgencyCredentials(context, agencyId, 'update')

  const body = GcFormsCredentialCreateSchema.parse(await context.readBody())
  assertValidPrivateKey(body.key)

  const item = await runAuthorizedGcFormsWrite(context, async trx => {
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
        .returning(['id', 'name_en', 'name_fr', 'key_id', 'user_id', 'form_id', 'revision', 'updated_at', 'created_at'])
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
  .select(['id', 'name_en', 'name_fr', 'key_id', 'user_id', 'form_id', 'revision', 'updated_at', 'created_at'])
  .where('id', '=', sql<string>`${credentialId}::bigint`)
  .where('agency_id', '=', sql<string>`${agencyId}::bigint`)
  .where('_deleted', '=', false)
  .forUpdate()
  .executeTakeFirst()

/** Maps a credential patch payload to the corresponding database update fields. */
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

/** Updates an active credential and replaces its encrypted private key when one is provided. */
export const patchGcFormsCredential = async (context: GcsExtensionRouteContext) => {
  const agencyId = getAgencyId(context)
  const credentialId = context.params.credentialId ?? ''
  authorizeGcFormsAgencyCredentials(context, agencyId, 'update')

  const body = GcFormsCredentialPatchSchema.parse(await context.readBody())
  if (body.key !== undefined) {
    assertValidPrivateKey(body.key)
  }

  const item = await runAuthorizedGcFormsWrite(context, async trx => {
    const existing = await getActiveCredentialRow(trx, agencyId, credentialId)
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

    const currentSecret = body.key === undefined
      ? null
      : await getEncryptedExtensionSecret<GcFormsIntegrationHostDatabase>(trx, {
          rootKey: getGcFormsSecretRootKey(),
          extensionKey: GCFORMS_EXTENSION_KEY,
          ownerType: 'agency',
          ownerId: agencyId,
          secretKey: credentialId
        })
    const currentPrivateKey = currentSecret === null
      ? null
      : GcFormsCredentialSecretSchema.parse(currentSecret).key
    const privateKeyChanged = body.key !== undefined && currentPrivateKey !== body.key
    const authenticationChanged = privateKeyChanged
      || (body.keyId !== undefined && body.keyId !== existing.key_id)
      || (body.userId !== undefined && body.userId !== existing.user_id)
      || (body.formId !== undefined && body.formId !== existing.form_id)
    if (authenticationChanged) {
      const pendingConfirmation = await trx
        .selectFrom('extensions.gcs_gcforms_submissions as submission')
        .innerJoin(
          'extensions.gcs_gcforms_connections as connection',
          'connection.id',
          'submission.connection_id'
        )
        .select('submission.id')
        .where('connection.agency_id', '=', sql<string>`${agencyId}::bigint`)
        .where('connection.credential_id', '=', String(existing.id))
        .where('submission.status', 'in', ['imported_pending_confirm', 'materialization_failed'])
        .where('submission._deleted', '=', false)
        .executeTakeFirst()
      if (pendingConfirmation) {
        throw createGcsExtensionUserError({
          statusCode: 409,
          code: 'GCS_GCFORMS_CREDENTIAL_UPDATE_RECOVERABLE_SUBMISSIONS',
          message: {
            en: 'This GC Forms credential authentication cannot be changed until all recoverable submissions using it are resolved.',
            fr: 'L authentification de ce justificatif GC Forms ne peut pas etre modifiee tant que toutes les soumissions recuperables qui l utilisent ne sont pas reglees.'
          }
        })
      }
    }

    const row = await trx
      .updateTable('extensions.gcs_gcforms_credentials')
      .set({
        ...patchValues(body),
        ...(authenticationChanged ? { revision: sql<number>`revision + 1` } : {})
      })
      .where('id', '=', sql<string>`${credentialId}::bigint`)
      .where('agency_id', '=', sql<string>`${agencyId}::bigint`)
      .where('_deleted', '=', false)
      .returning(['id', 'name_en', 'name_fr', 'key_id', 'user_id', 'form_id', 'revision', 'updated_at', 'created_at'])
      .executeTakeFirstOrThrow()

    if (privateKeyChanged && body.key !== undefined) {
      await storePrivateKey(trx, agencyId, credentialId, body.key)
    }

    return toSummary(row)
  })

  return {
    ok: true,
    item
  }
}

/** Soft-deletes an unused agency credential and removes its encrypted private key. */
export const deleteGcFormsCredential = async (context: GcsExtensionRouteContext) => {
  const agencyId = getAgencyId(context)
  const credentialId = context.params.credentialId ?? ''
  authorizeGcFormsAgencyCredentials(context, agencyId, 'update')

  await runAuthorizedGcFormsWrite(context, async trx => {
    const credential = await trx
      .selectFrom('extensions.gcs_gcforms_credentials')
      .select('id')
      .where('id', '=', sql<string>`${credentialId}::bigint`)
      .where('agency_id', '=', sql<string>`${agencyId}::bigint`)
      .where('_deleted', '=', false)
      .forUpdate()
      .executeTakeFirst()
    if (!credential) {
      return
    }

    const pendingConfirmation = await trx
      .selectFrom('extensions.gcs_gcforms_submissions as submission')
      .innerJoin(
        'extensions.gcs_gcforms_connections as connection',
        'connection.id',
        'submission.connection_id'
      )
      .select('submission.id')
      .where('connection.agency_id', '=', sql<string>`${agencyId}::bigint`)
      .where('connection.credential_id', '=', String(credential.id))
      .where('submission.status', 'in', ['imported_pending_confirm', 'materialization_failed'])
      .where('submission._deleted', '=', false)
      .executeTakeFirst()
    if (pendingConfirmation) {
      throw createGcsExtensionUserError({
        statusCode: 409,
        code: 'GCS_GCFORMS_CREDENTIAL_RECOVERABLE_SUBMISSIONS',
        message: {
          en: 'This GC Forms credential cannot be deleted until all recoverable submissions using it are resolved.',
          fr: 'Ce justificatif GC Forms ne peut pas etre supprime tant que toutes les soumissions recuperables qui l utilisent ne sont pas reglees.'
        }
      })
    }

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

    await deleteEncryptedExtensionSecret<GcFormsIntegrationHostDatabase>(
      trx,
      GCFORMS_EXTENSION_KEY,
      'agency',
      agencyId,
      credentialId
    )
  })

  return { ok: true }
}
