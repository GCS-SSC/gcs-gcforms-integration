/* eslint-disable jsdoc/require-jsdoc */
import { createPrivateKey } from 'node:crypto'
import {
  createGcsExtensionUserError,
  deleteEncryptedExtensionSecret,
  setEncryptedExtensionSecret,
  type GcsExtensionRouteContext
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

type CredentialRouteContext = GcsExtensionRouteContext

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

export const listGcFormsCredentials = async (contextOrEvent: Parameters<typeof toCredentialContext>[0]) => {
  const context = toCredentialContext(contextOrEvent)
  const agencyId = getAgencyId(context)
  authorizeGcFormsAgencyCredentials(context, agencyId, 'read')

  const rows = await asGcFormsIntegrationDb(context.db)
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

export const saveGcFormsCredential = async (contextOrEvent: Parameters<typeof toCredentialContext>[0]) => {
  const context = toCredentialContext(contextOrEvent)
  const agencyId = getAgencyId(context)
  authorizeGcFormsAgencyCredentials(context, agencyId, 'update')

  const body = GcFormsCredentialInputSchema.parse(await context.readBody())
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

  await setEncryptedExtensionSecret(asGcFormsIntegrationDb(context.db) as never, {
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

export const deleteGcFormsCredential = async (contextOrEvent: Parameters<typeof toCredentialContext>[0]) => {
  const context = toCredentialContext(contextOrEvent)
  const agencyId = getAgencyId(context)
  const credentialId = context.params.credentialId ?? ''
  authorizeGcFormsAgencyCredentials(context, agencyId, 'update')

  await deleteEncryptedExtensionSecret(
    asGcFormsIntegrationDb(context.db) as never,
    GCFORMS_EXTENSION_KEY,
    'agency',
    agencyId,
    credentialId
  )

  return { ok: true }
}
