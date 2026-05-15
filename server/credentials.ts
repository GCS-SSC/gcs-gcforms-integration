/* eslint-disable jsdoc/require-jsdoc */
import { createPrivateKey } from 'node:crypto'
import { readBody, type H3Event } from 'h3'
import {
  createGcsExtensionUserError,
  deleteEncryptedExtensionSecret,
  setEncryptedExtensionSecret
} from '@gcs-ssc/extensions/server'
import {
  GCFORMS_EXTENSION_KEY,
  GcFormsCredentialInputSchema,
  type GcFormsCredentialSummary
} from '../shared/gcforms'
import { asGcFormsIntegrationDb } from './db'
import { getGcFormsSecretRootKey } from './runtime'

type ExtensionAuthContext = {
  userAbilities: {
    authorize: (subject: 'agency', action: 'read' | 'update', scope: unknown) => boolean
  }
}

type CredentialRouteEvent = H3Event & {
  context: {
    $authContext?: ExtensionAuthContext
    $db: unknown
    params?: Record<string, string | undefined>
  }
}

const getAgencyId = (event: CredentialRouteEvent): string => event.context.params?.agencyId ?? ''

const authorizeGcFormsAgencyCredentials = (
  event: CredentialRouteEvent,
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

  const authContext = event.context.$authContext
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

const parseCredentialMetadata = (
  credentialId: string,
  metadata: unknown,
  updatedAt: unknown
): GcFormsCredentialSummary => {
  const source = typeof metadata === 'object' && metadata !== null ? metadata as Record<string, unknown> : {}

  return {
    credentialId,
    keyId: typeof source.keyId === 'string' ? source.keyId : '',
    userId: typeof source.userId === 'string' ? source.userId : '',
    formId: typeof source.formId === 'string' ? source.formId : '',
    updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : typeof updatedAt === 'string' ? updatedAt : null
  }
}

export const listGcFormsCredentials = async (event: CredentialRouteEvent) => {
  const agencyId = getAgencyId(event)
  authorizeGcFormsAgencyCredentials(event, agencyId, 'read')

  const rows = await asGcFormsIntegrationDb(event.context.$db)
    .selectFrom('extensions.secret_entry')
    .select(['secret_key', 'metadata', 'updated_at', 'created_at'])
    .where('extension_key', '=', GCFORMS_EXTENSION_KEY)
    .where('owner_type', '=', 'agency')
    .where('owner_id', '=', agencyId)
    .where('_deleted', '=', false)
    .orderBy('secret_key', 'asc')
    .execute()

  const items = rows.map(row => parseCredentialMetadata(
    row.secret_key,
    row.metadata,
    row.updated_at ?? row.created_at
  ))

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

export const saveGcFormsCredential = async (event: CredentialRouteEvent) => {
  const agencyId = getAgencyId(event)
  authorizeGcFormsAgencyCredentials(event, agencyId, 'update')

  const body = GcFormsCredentialInputSchema.parse(await readBody(event))
  try {
    createPrivateKey(body.key)
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

  await setEncryptedExtensionSecret(asGcFormsIntegrationDb(event.context.$db) as never, {
    rootKey: getGcFormsSecretRootKey(),
    extensionKey: GCFORMS_EXTENSION_KEY,
    ownerType: 'agency',
    ownerId: agencyId,
    secretKey: body.credentialId,
    value: {
      keyId: body.keyId,
      key: body.key,
      userId: body.userId,
      formId: body.formId
    },
    metadata: {
      credentialId: body.credentialId,
      keyId: body.keyId,
      userId: body.userId,
      formId: body.formId
    }
  })

  return {
    ok: true,
    item: {
      credentialId: body.credentialId,
      keyId: body.keyId,
      userId: body.userId,
      formId: body.formId,
      updatedAt: new Date().toISOString()
    } satisfies GcFormsCredentialSummary
  }
}

export const deleteGcFormsCredential = async (event: CredentialRouteEvent) => {
  const agencyId = getAgencyId(event)
  const credentialId = event.context.params?.credentialId ?? ''
  authorizeGcFormsAgencyCredentials(event, agencyId, 'update')

  await deleteEncryptedExtensionSecret(
    asGcFormsIntegrationDb(event.context.$db) as never,
    GCFORMS_EXTENSION_KEY,
    'agency',
    agencyId,
    credentialId
  )

  return { ok: true }
}
