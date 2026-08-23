import { createHash } from 'node:crypto'
import { sql, type Selectable, type Transaction } from 'kysely'
import type { JsonValue } from '@gcs-ssc/extensions'
import {
  createGcsExtensionUserError,
  getEncryptedExtensionSecret,
  isGcsExtensionUserError,
  lockGcsExtensionLifecycleScope,
  type GcsExtensionRouteContext,
  resolveExtensionStreamContext
} from '@gcs-ssc/extensions/server'
import {
  DEFAULT_GCFORMS_API_URL,
  DEFAULT_GCFORMS_IDP_URL,
  DEFAULT_GCFORMS_PROJECT_IDENTIFIER,
  GCFORMS_EXTENSION_KEY,
  GcFormsCredentialSecretSchema,
  gcFormsTemplateShapesEqual,
  getMissingGcFormsClaimQuestionIds,
  normalizeGcFormsAnswers,
  normalizeGcFormsTemplate,
  parseGcFormsAgencyConfig,
  parseGcFormsStreamConfig,
  type GcsGcFormsStreamConfig,
  type GcFormsDecryptedSubmission,
  type GcFormsNewSubmission,
  type GcFormsPrivateApiKey
} from '../shared/gcforms.ts'
import { GcFormsApiClient, verifyGcFormsIntegrity } from './gcforms-client.ts'
import {
  asGcFormsIntegrationDb,
  executeGcFormsTransaction,
  type GcFormsIntegrationDb,
  type GcFormsIntegrationHostDatabase,
  type GcFormsSubmissionStatus
} from './db.ts'
import { gcFormsJsonbValue } from './jsonb.ts'
import { materializeGcFormsClaimSubmission } from './materialize-claims.ts'
import { shouldConfirmGcFormsSubmission } from './submission-confirmation.ts'
import { prepareGcFormsSubmissionMaterialization } from './submission-materialization.ts'

type ConnectionRow = Selectable<
  GcFormsIntegrationHostDatabase['extensions.gcs_gcforms_connections']
>

type CredentialRow = {
  id: string
  agency_id: string
  key_id: string
  user_id: string
  form_id: string
  revision: number
}

type GcFormsCredentialSessionIdentity = {
  credentialRevision: number
  secretEntryId: string
  secretUpdatedAt: string
}

type IntegrationRow = Selectable<
  GcFormsIntegrationHostDatabase['extensions.gcs_gcforms_integrations']
>

type ImportRunRow = {
  id: string
}

type SubmissionRow = {
  id: string
  status: GcFormsSubmissionStatus
}

type SyncSubmissionContext = {
  db: GcFormsIntegrationDb
  streamId: string
  connection: ConnectionRow
  integration: IntegrationRow
  config: GcsGcFormsStreamConfig
  currentTemplate: unknown
  authorizeAgreementUpdate: (agreementId: string) => Promise<void>
}

export type GcFormsSyncSessionIdentity = {
  configFingerprint: string
  connectionId: string
  credentialId: string
  credentialRevision: number
  secretEntryId: string
  secretUpdatedAt: string
}

type GcFormsTemplateChangedError = Error & {
  code: string
  gcFormsSyncSession: GcFormsSyncSessionIdentity
}

const maybeString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const configFingerprint = (config: GcsGcFormsStreamConfig): string => JSON.stringify(config)

const createSyncSessionIdentity = (
  config: GcsGcFormsStreamConfig,
  connectionId: string,
  credentialIdentity: GcFormsCredentialSessionIdentity
): GcFormsSyncSessionIdentity => ({
  configFingerprint: configFingerprint(config),
  connectionId,
  credentialId: assertConfiguredCredential(config),
  ...credentialIdentity
})

const createGcFormsConfigChangedError = () => createGcsExtensionUserError({
  statusCode: 409,
  code: 'GCS_GCFORMS_CONFIG_CHANGED',
  message: {
    en: 'The GC Forms configuration changed while synchronization was running. Start the synchronization again.',
    fr: 'La configuration de GC Forms a change pendant la synchronisation. Relancez la synchronisation.'
  }
})

const getTemplateChangedSession = (error: unknown): GcFormsSyncSessionIdentity | null => {
  if (!isRecord(error) || !isRecord(error.gcFormsSyncSession)) {
    return null
  }
  const {
    configFingerprint: fingerprint,
    connectionId,
    credentialId,
    credentialRevision,
    secretEntryId,
    secretUpdatedAt
  } = error.gcFormsSyncSession
  if (
    typeof fingerprint !== 'string'
    || typeof connectionId !== 'string'
    || typeof credentialId !== 'string'
    || typeof credentialRevision !== 'number'
    || typeof secretEntryId !== 'string'
    || typeof secretUpdatedAt !== 'string'
  ) {
    return null
  }
  return {
    configFingerprint: fingerprint,
    connectionId,
    credentialId,
    credentialRevision,
    secretEntryId,
    secretUpdatedAt
  }
}

const DEV_EXTENSION_SECRETS_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='

/** Returns the configured credential-encryption key, using the fallback when `NODE_ENV` is neither production nor test. */
export const getGcFormsSecretRootKey = (): string => {
  const key = process.env.GCS_EXTENSION_SECRETS_KEY
  if (key) {
    return key
  }

  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
    return DEV_EXTENSION_SECRETS_KEY
  }

  throw createGcsExtensionUserError({
    statusCode: 400,
    code: 'GCS_GCFORMS_SECRET_ROOT_KEY_MISSING',
    message: {
      en: 'The server encryption key for extension credentials is not configured.',
      fr: 'La cle de chiffrement serveur pour les justificatifs d extension n est pas configuree.'
    }
  })
}

/** Runs a GC Forms mutation under the host's ordered auth and extension lifecycle locks. */
export const runAuthorizedGcFormsWrite = async <T>(
  context: GcsExtensionRouteContext,
  operation: (trx: GcFormsIntegrationDb) => Promise<T>,
  streamId?: string
): Promise<T> => {
  const writeAuthorization = context.writeAuthorization
  if (!writeAuthorization) {
    throw new Error('GC Forms writes require host-provided transaction authorization.')
  }
  const scopedAgencyId = context.agency?.agencyId ?? context.stream?.agencyId
  if (typeof scopedAgencyId !== 'string' || !scopedAgencyId) {
    throw new Error('GC Forms writes require a resolved agency scope.')
  }

  return await executeGcFormsTransaction(context.db, async trx => {
    await writeAuthorization.lockAuthState(trx)
    await lockGcsExtensionLifecycleScope(
      trx as unknown as Transaction<unknown>,
      GCFORMS_EXTENSION_KEY,
      scopedAgencyId,
      streamId
    )
    const authorizeCurrentScope = writeAuthorization.authorizeCurrentScope === undefined
      ? writeAuthorization.authorizeCurrentEntity
      : writeAuthorization.authorizeCurrentScope
    await authorizeCurrentScope(trx)
    return await operation(trx)
  })
}

const createGcFormsCredentialMissingError = () => createGcsExtensionUserError({
  statusCode: 400,
  code: 'GCS_GCFORMS_CREDENTIAL_MISSING',
  message: {
    en: 'The selected GC Forms credential is not available on the server.',
    fr: 'Le justificatif GC Forms selectionne n est pas disponible sur le serveur.'
  }
})

const timestampIdentity = (value: Date | string): string => value instanceof Date
  ? value.toISOString()
  : value

/** Loads active credential metadata and secret identity from one database snapshot. */
const getGcFormsCredentialMetadataState = async (
  db: GcFormsIntegrationDb,
  agencyId: string,
  credentialId: string
): Promise<{ credential: CredentialRow; identity: GcFormsCredentialSessionIdentity }> => {
  const row = await db
    .selectFrom('extensions.gcs_gcforms_credentials as credential')
    .innerJoin('extensions.secret_entry as secret', join => join
      .on('secret.extension_key', '=', GCFORMS_EXTENSION_KEY)
      .on('secret.owner_type', '=', 'agency')
      .on('secret.owner_id', '=', sql<string>`credential.agency_id::text`)
      .on('secret.secret_key', '=', sql<string>`credential.id::text`)
      .on('secret._deleted', '=', false))
    .select([
      'credential.revision as credential_revision',
      'credential.id as credential_id',
      'credential.agency_id as credential_agency_id',
      'credential.key_id as credential_key_id',
      'credential.user_id as credential_user_id',
      'credential.form_id as credential_form_id',
      'secret.id as secret_entry_id',
      'secret.created_at as secret_created_at',
      'secret.updated_at as secret_updated_at'
    ])
    .where('credential.id', '=', sql<string>`${credentialId}::bigint`)
    .where('credential.agency_id', '=', sql<string>`${agencyId}::bigint`)
    .where('credential._deleted', '=', false)
    .executeTakeFirst()
  if (!row) {
    throw createGcFormsCredentialMissingError()
  }
  return {
    credential: {
      id: String(row.credential_id),
      agency_id: String(row.credential_agency_id),
      key_id: row.credential_key_id,
      user_id: row.credential_user_id,
      form_id: row.credential_form_id,
      revision: row.credential_revision
    },
    identity: {
      credentialRevision: row.credential_revision,
      secretEntryId: String(row.secret_entry_id),
      secretUpdatedAt: timestampIdentity(row.secret_updated_at ?? row.secret_created_at)
    }
  }
}

/** Loads immutable authentication identity markers for an active agency credential. */
const getGcFormsCredentialSessionIdentity = async (
  db: GcFormsIntegrationDb,
  agencyId: string,
  credentialId: string
): Promise<GcFormsCredentialSessionIdentity> => (
  await getGcFormsCredentialMetadataState(db, agencyId, credentialId)
).identity

/** Loads credential metadata, identity markers, and its decrypted private API key for an agency. */
const getGcFormsCredentialState = async (
  rawDb: unknown,
  agencyId: string,
  credentialId: string
): Promise<{ credential: GcFormsPrivateApiKey; identity: GcFormsCredentialSessionIdentity }> => {
  const db = asGcFormsIntegrationDb(rawDb)
  const { credential: row, identity } = await getGcFormsCredentialMetadataState(
    db,
    agencyId,
    credentialId
  )

  const credential = await getEncryptedExtensionSecret<GcFormsIntegrationHostDatabase>(db, {
    rootKey: getGcFormsSecretRootKey(),
    extensionKey: GCFORMS_EXTENSION_KEY,
    ownerType: 'agency',
    ownerId: agencyId,
    secretKey: String(row.id)
  })
  if (!credential) {
    throw createGcFormsCredentialMissingError()
  }

  const secret = GcFormsCredentialSecretSchema.parse(credential)
  return {
    credential: {
      keyId: row.key_id,
      key: secret.key,
      userId: row.user_id,
      formId: row.form_id
    },
    identity
  }
}

/** Loads credential metadata and decrypts its private API key for an agency. */
export const getGcFormsCredential = async (
  rawDb: unknown,
  agencyId: string,
  credentialId: string
): Promise<GcFormsPrivateApiKey> => (await getGcFormsCredentialState(rawDb, agencyId, credentialId)).credential

/** Loads active credential metadata and rejects credentials outside the requested agency. */
const getGcFormsCredentialRow = async (
  db: GcFormsIntegrationDb,
  agencyId: string,
  credentialId: string
): Promise<CredentialRow> => {
  const row = await db
    .selectFrom('extensions.gcs_gcforms_credentials')
    .select(['id', 'agency_id', 'key_id', 'user_id', 'form_id', 'revision'])
    .where('id', '=', sql<string>`${credentialId}::bigint`)
    .where('agency_id', '=', sql<string>`${agencyId}::bigint`)
    .where('_deleted', '=', false)
    .executeTakeFirst()
  if (!row) {
    throw createGcsExtensionUserError({
      statusCode: 400,
      code: 'GCS_GCFORMS_CREDENTIAL_MISSING',
      message: {
        en: 'The selected GC Forms credential is not available on the server.',
        fr: 'Le justificatif GC Forms selectionne n est pas disponible sur le serveur.'
      }
    })
  }

  return row
}

const assertConfiguredCredential = (config: GcsGcFormsStreamConfig): string => {
  if (config.credentialId) {
    return config.credentialId
  }

  throw createGcsExtensionUserError({
    statusCode: 400,
    code: 'GCS_GCFORMS_CONFIG_INCOMPLETE',
    message: {
      en: 'Select a GC Forms agency credential before syncing.',
      fr: 'Selectionnez un justificatif GC Forms de l organisation avant la synchronisation.'
    }
  })
}

/** Returns the configured imported-claim status or rejects incomplete Agency configuration. */
const assertConfiguredSubmissionStatus = (config: GcsGcFormsStreamConfig): string => {
  if (config.submissionStatusId) {
    return config.submissionStatusId
  }

  throw createGcsExtensionUserError({
    statusCode: 400,
    code: 'GCS_GCFORMS_SUBMISSION_STATUS_REQUIRED',
    message: {
      en: 'Select an Agency status for claims imported from GC Forms before syncing.',
      fr: 'Sélectionnez un statut d’organisation pour les réclamations importées de GC Forms avant la synchronisation.'
    }
  })
}

/** Authorizes role access to a stream's GC Forms integration. */
export const authorizeGcFormsStream = async (
  context: GcsExtensionRouteContext,
  streamId: string,
  action: 'read' | 'update'
): Promise<void> => {
  const authContext = context.auth
  if (!authContext) {
    throw createGcsExtensionUserError({
      statusCode: 401,
      code: 'GCS_GCFORMS_UNAUTHORIZED',
      message: {
        en: 'You must be signed in to use this GC Forms integration.',
        fr: 'Vous devez ouvrir une session pour utiliser cette integration GC Forms.'
      }
    })
  }

  const db = asGcFormsIntegrationDb(context.db)
  const streamContext = await resolveExtensionStreamContext(db, streamId)
  if (!streamContext) {
    throw createGcsExtensionUserError({
      statusCode: 404,
      code: 'GCS_GCFORMS_STREAM_NOT_FOUND',
      message: {
        en: 'Transfer payment stream was not found.',
        fr: 'Le volet de paiements de transfert est introuvable.'
      }
    })
  }

  const canAccessScope = authContext.userAbilities.authorize('transfer_payment', action, streamContext.scope)

  if (!canAccessScope) {
    throw createGcsExtensionUserError({
      statusCode: 403,
      code: 'GCS_GCFORMS_FORBIDDEN',
      message: {
        en: 'You do not have access to this GC Forms integration.',
        fr: 'Vous n avez pas acces a cette integration GC Forms.'
      }
    })
  }
}

/** Resolves enabled stream and agency settings without requiring remote credential material. */
const resolveStreamConfig = async (
  db: GcFormsIntegrationDb,
  streamId: string
): Promise<{ agencyId: string; config: GcsGcFormsStreamConfig }> => {
  const streamContext = await resolveExtensionStreamContext(db, streamId)
  if (!streamContext) {
    throw createGcsExtensionUserError({
      statusCode: 404,
      code: 'GCS_GCFORMS_STREAM_NOT_FOUND',
      message: {
        en: 'Transfer payment stream was not found.',
        fr: 'Le volet de paiements de transfert est introuvable.'
      }
    })
  }

  const row = await db
    .selectFrom('extensions.stream_configuration')
    .select(['enabled', 'config'])
    .where('stream_id', '=', streamId)
    .where('extension_key', '=', GCFORMS_EXTENSION_KEY)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  const agencyRow = await db
    .selectFrom('extensions.agency_enablement')
    .select(['config'])
    .where('agency_id', '=', streamContext.agencyId)
    .where('extension_key', '=', GCFORMS_EXTENSION_KEY)
    .where('enabled', '=', true)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  if (!row?.enabled) {
    throw createGcsExtensionUserError({
      statusCode: 400,
      code: 'GCS_GCFORMS_STREAM_DISABLED',
      message: {
        en: 'GC Forms integration is not enabled for this stream.',
        fr: 'L integration GC Forms n est pas activee pour ce volet.'
      }
    })
  }

  const agencyConfigSource = isRecord(agencyRow?.config)
    ? agencyRow.config
    : {}
  const agencyConfig = parseGcFormsAgencyConfig(agencyRow?.config)
  const config = parseGcFormsStreamConfig(row.config)
  config.apiUrl = agencyConfig.apiUrl || DEFAULT_GCFORMS_API_URL
  config.identityProviderUrl = agencyConfig.identityProviderUrl || config.identityProviderUrl
  if (Object.hasOwn(agencyConfigSource, 'confirmSubmissions')) {
    config.confirmSubmissions = agencyConfig.confirmSubmissions
  }
  config.submissionStatusId = agencyConfig.submissionStatusId
  assertConfiguredSubmissionStatus(config)

  return {
    agencyId: streamContext.agencyId,
    config
  }
}

/** Resolves an enabled stream configuration, merging agency settings and validating its credential. */
export const getStreamConfig = async (
  db: GcFormsIntegrationDb,
  streamId: string
): Promise<GcsGcFormsStreamConfig> => {
  const { agencyId, config } = await resolveStreamConfig(db, streamId)
  await getGcFormsCredentialRow(db, agencyId, assertConfiguredCredential(config))
  return config
}

type GcFormsConnectionIdentity = {
  agencyId: string
  credentialId: string
  credentialRevision: number
  secretEntryId: string
  secretUpdatedAt: string
  formId: string
  apiUrl: string
  identityProviderUrl: string
  projectIdentifier: string
}

const resolveConnectionIdentity = async (
  db: GcFormsIntegrationDb,
  streamId: string,
  config: GcsGcFormsStreamConfig
): Promise<GcFormsConnectionIdentity> => {
  const streamContext = await resolveExtensionStreamContext(db, streamId)
  if (!streamContext) {
    throw createGcsExtensionUserError({
      statusCode: 404,
      code: 'GCS_GCFORMS_STREAM_NOT_FOUND',
      message: {
        en: 'Transfer payment stream was not found.',
        fr: 'Le volet de paiements de transfert est introuvable.'
      }
    })
  }
  const credentialId = assertConfiguredCredential(config)
  const { credential, identity: credentialIdentity } = await getGcFormsCredentialMetadataState(
    db,
    streamContext.agencyId,
    credentialId
  )
  return {
    agencyId: streamContext.agencyId,
    credentialId: String(credential.id),
    credentialRevision: credentialIdentity.credentialRevision,
    secretEntryId: credentialIdentity.secretEntryId,
    secretUpdatedAt: credentialIdentity.secretUpdatedAt,
    formId: credential.form_id,
    apiUrl: config.apiUrl || DEFAULT_GCFORMS_API_URL,
    identityProviderUrl: config.identityProviderUrl || DEFAULT_GCFORMS_IDP_URL,
    projectIdentifier: config.projectIdentifier || DEFAULT_GCFORMS_PROJECT_IDENTIFIER
  }
}

const findConnectionByIdentity = async (
  db: GcFormsIntegrationDb,
  streamId: string,
  identity: GcFormsConnectionIdentity
): Promise<ConnectionRow | undefined> => await db
  .selectFrom('extensions.gcs_gcforms_connections')
  .selectAll()
  .where('stream_id', '=', streamId)
  .where('credential_id', '=', identity.credentialId)
  .where('credential_revision', '=', identity.credentialRevision)
  .where('secret_entry_id', '=', identity.secretEntryId)
  .where('secret_updated_at', '=', identity.secretUpdatedAt)
  .where('form_id', '=', identity.formId)
  .where('api_url', '=', identity.apiUrl)
  .where('identity_provider_url', '=', identity.identityProviderUrl)
  .where('project_identifier', '=', identity.projectIdentifier)
  .where('_deleted', '=', false)
  .executeTakeFirst()

export const findCurrentGcFormsConnection = async (
  db: GcFormsIntegrationDb,
  streamId: string,
  config: GcsGcFormsStreamConfig
): Promise<ConnectionRow | undefined> => await findConnectionByIdentity(
  db,
  streamId,
  await resolveConnectionIdentity(db, streamId, config)
)

/** Returns the most recently stored template catalog and review state for a stream. */
export const getStoredTemplate = async (
  rawDb: unknown,
  streamId: string
) => {
  const db = asGcFormsIntegrationDb(rawDb)
  const config = await getStreamConfig(db, streamId)
  const connection = await findCurrentGcFormsConnection(db, streamId, config)
  const stored = connection
    ? await db
        .selectFrom('extensions.gcs_gcforms_templates')
        .select(['field_catalog', 'title_en', 'title_fr'])
        .where('connection_id', '=', String(connection.id))
        .where('_deleted', '=', false)
        .executeTakeFirst()
    : undefined
  const streamStored = stored ?? await db
    .selectFrom('extensions.gcs_gcforms_templates')
    .innerJoin(
      'extensions.gcs_gcforms_connections',
      'extensions.gcs_gcforms_connections.id',
      'extensions.gcs_gcforms_templates.connection_id'
    )
    .select([
      'extensions.gcs_gcforms_templates.field_catalog as field_catalog',
      'extensions.gcs_gcforms_templates.title_en as title_en',
      'extensions.gcs_gcforms_templates.title_fr as title_fr'
    ])
    .where('extensions.gcs_gcforms_connections.stream_id', '=', streamId)
    .where('extensions.gcs_gcforms_connections._deleted', '=', false)
    .where('extensions.gcs_gcforms_templates._deleted', '=', false)
    .orderBy('extensions.gcs_gcforms_templates.refreshed_at', 'desc')
    .executeTakeFirst()

  return {
    fieldCatalog: streamStored?.field_catalog ?? [],
    title: {
      en: streamStored?.title_en ?? null,
      fr: streamStored?.title_fr ?? null
    },
    templateShapeChanged: config.templateShapeChanged
  }
}

/** Updates identity-neutral presentation settings on an exact connection version. */
const updateConnection = async (
  db: GcFormsIntegrationDb,
  id: string,
  config: GcsGcFormsStreamConfig
) => {
  return await db
    .updateTable('extensions.gcs_gcforms_connections')
    .set({
      contact_email: config.contactEmail || null,
      preferred_language: config.preferredLanguage,
      updated_at: new Date()
    })
    .where('id', '=', sql<string>`${String(id)}::bigint`)
    .returningAll()
    .executeTakeFirstOrThrow()
}

/** Returns or idempotently creates the immutable remote-identity version for the current configuration. */
export const ensureConnection = async (
  rawDb: unknown,
  streamId: string,
  config: GcsGcFormsStreamConfig
): Promise<ConnectionRow> => {
  const db = asGcFormsIntegrationDb(rawDb)
  const identity = await resolveConnectionIdentity(db, streamId, config)
  const existing = await findConnectionByIdentity(db, streamId, identity)

  if (existing) {
    return await updateConnection(db, existing.id, config)
  }

  const inserted = await db
    .insertInto('extensions.gcs_gcforms_connections')
    .values({
      agency_id: identity.agencyId,
      stream_id: streamId,
      credential_id: identity.credentialId,
      credential_revision: identity.credentialRevision,
      secret_entry_id: identity.secretEntryId,
      secret_updated_at: identity.secretUpdatedAt,
      form_id: identity.formId,
      api_url: identity.apiUrl,
      identity_provider_url: identity.identityProviderUrl,
      project_identifier: identity.projectIdentifier,
      contact_email: config.contactEmail || null,
      preferred_language: config.preferredLanguage,
      status: 'active'
    })
    .onConflict(conflict => conflict.doNothing())
    .returningAll()
    .executeTakeFirst()
  if (inserted) {
    return inserted
  }

  const concurrent = await findConnectionByIdentity(db, streamId, identity)
  if (!concurrent) {
    throw new Error('GC Forms connection identity conflict did not resolve to an active version.')
  }
  return await updateConnection(db, concurrent.id, config)
}

const integrationConfigFingerprint = (config: GcsGcFormsStreamConfig): string => createHash('sha256')
  .update(JSON.stringify(config))
  .digest('hex')

/** Returns or idempotently creates the immutable integration and mapping version for this configuration. */
export const ensureIntegration = async (
  rawDb: unknown,
  streamId: string,
  connectionId: string,
  config: GcsGcFormsStreamConfig
): Promise<IntegrationRow> => {
  return await executeGcFormsTransaction(rawDb, async db => {
    const normalizedConfig = parseGcFormsStreamConfig(config)
    const configFingerprint = integrationConfigFingerprint(normalizedConfig)
    const existing = await db
      .selectFrom('extensions.gcs_gcforms_integrations')
      .selectAll()
      .where('connection_id', '=', connectionId)
      .where('config_fingerprint', '=', configFingerprint)
      .where('_deleted', '=', false)
      .executeTakeFirst()
    if (existing) {
      return existing
    }

    const inserted = await db
      .insertInto('extensions.gcs_gcforms_integrations')
      .values({
        connection_id: connectionId,
        stream_id: streamId,
        name_en: 'GC Forms integration',
        name_fr: 'Integration GC Forms',
        enabled: true,
        config_fingerprint: configFingerprint,
        config: gcFormsJsonbValue(normalizedConfig)
      })
      .onConflict(conflict => conflict.doNothing())
      .returningAll()
      .executeTakeFirst()
    if (!inserted) {
      const concurrent = await db
        .selectFrom('extensions.gcs_gcforms_integrations')
        .selectAll()
        .where('connection_id', '=', connectionId)
        .where('config_fingerprint', '=', configFingerprint)
        .where('_deleted', '=', false)
        .executeTakeFirst()
      if (!concurrent) {
        throw new Error('GC Forms integration identity conflict did not resolve to an active version.')
      }
      return concurrent
    }

    if (normalizedConfig.mappings.length > 0) {
      await db
        .insertInto('extensions.gcs_gcforms_field_mappings')
        .values(normalizedConfig.mappings.map(mapping => ({
          integration_id: String(inserted.id),
          mapping_key: mapping.id,
          source_question_id: mapping.sourceQuestionId,
          destination_entity: mapping.destinationEntity,
          destination_path: mapping.destinationPath,
          transform: mapping.transform,
          required: mapping.required,
          default_value: gcFormsJsonbValue(mapping.defaultValue),
          on_missing: mapping.onMissing,
          on_invalid: mapping.onInvalid
        })))
        .execute()
    }

    return inserted
  })
}

/** Creates a GC Forms API client and captures the exact credential identity used by this session. */
const createConfiguredClientSession = async (
  rawDb: unknown,
  streamId: string,
  config: GcsGcFormsStreamConfig
): Promise<{ client: GcFormsApiClient; credentialIdentity: GcFormsCredentialSessionIdentity }> => {
  const credentialId = assertConfiguredCredential(config)
  const db = asGcFormsIntegrationDb(rawDb)
  const streamContext = await resolveExtensionStreamContext(db, streamId)
  if (!streamContext) {
    throw createGcsExtensionUserError({
      statusCode: 404,
      code: 'GCS_GCFORMS_STREAM_NOT_FOUND',
      message: {
        en: 'Transfer payment stream was not found.',
        fr: 'Le volet de paiements de transfert est introuvable.'
      }
    })
  }

  const { credential, identity } = await getGcFormsCredentialState(
    db,
    streamContext.agencyId,
    credentialId
  )
  return {
    client: new GcFormsApiClient({
      apiUrl: config.apiUrl,
      identityProviderUrl: config.identityProviderUrl,
      projectIdentifier: config.projectIdentifier,
      privateApiKey: {
        ...credential
      }
    }),
    credentialIdentity: identity
  }
}

/** Creates a GC Forms API client from the stream's agency credential and connection settings. */
export const createConfiguredClient = async (
  rawDb: unknown,
  streamId: string,
  config: GcsGcFormsStreamConfig
): Promise<GcFormsApiClient> => (await createConfiguredClientSession(rawDb, streamId, config)).client

/** Fetches, validates, and stores the current form template and normalized field catalog. */
export const refreshTemplate = async (
  rawDb: unknown,
  streamId: string
) => {
  const db = asGcFormsIntegrationDb(rawDb)
  const config = await getStreamConfig(db, streamId)
  const connection = await ensureConnection(rawDb, streamId, config)
  await ensureIntegration(rawDb, streamId, String(connection.id), config)
  const client = await createConfiguredClient(rawDb, streamId, config)
  const template = await client.getFormTemplate()
  assertGcFormsClaimTemplateShape(template)
  const fieldCatalog = normalizeGcFormsTemplate(template)

  const existing = await db
    .selectFrom('extensions.gcs_gcforms_templates')
    .select('id')
    .where('connection_id', '=', String(connection.id))
    .where('_deleted', '=', false)
    .executeTakeFirst()

  if (existing) {
    await db
      .updateTable('extensions.gcs_gcforms_templates')
      .set({
        form_id: connection.form_id,
        title_en: maybeString(template.titleEn),
        title_fr: maybeString(template.titleFr),
        template: gcFormsJsonbValue(template),
        field_catalog: gcFormsJsonbValue(fieldCatalog),
        refreshed_at: new Date()
      })
      .where('id', '=', String(existing.id))
      .execute()
  } else {
    await db
      .insertInto('extensions.gcs_gcforms_templates')
      .values({
        connection_id: String(connection.id),
        form_id: connection.form_id,
        title_en: maybeString(template.titleEn),
        title_fr: maybeString(template.titleFr),
        template: gcFormsJsonbValue(template),
        field_catalog: gcFormsJsonbValue(fieldCatalog)
      })
      .execute()
  }

  await db
    .updateTable('extensions.gcs_gcforms_connections')
    .set({ last_template_refresh_at: new Date(), updated_at: new Date() })
    .where('id', '=', String(connection.id))
    .execute()

  await updateStreamTemplateShapeChanged(db, streamId, false)

  return {
    connection,
    template,
    fieldCatalog
  }
}

/** Persists whether the current remote template shape differs from the reviewed stream template. */
export const updateStreamTemplateShapeChanged = async (
  db: GcFormsIntegrationDb,
  streamId: string,
  templateShapeChanged: boolean
) => {
  await db
    .updateTable('extensions.stream_configuration')
    .set({
      config: sql<JsonValue>`jsonb_set(
        config,
        '{templateShapeChanged}',
        ${JSON.stringify(templateShapeChanged)}::jsonb,
        true
      )`
    })
    .where('stream_id', '=', streamId)
    .where('extension_key', '=', GCFORMS_EXTENSION_KEY)
    .where('_deleted', '=', false)
    .execute()
}

/** Persists template drift only when the renewed stream session still matches the failing remote read. */
export const persistGcFormsTemplateShapeChangedForSession = async (
  context: GcsExtensionRouteContext,
  streamId: string,
  error: unknown
): Promise<void> => {
  const expectedSession = getTemplateChangedSession(error)
  if (!expectedSession) {
    throw createGcFormsConfigChangedError()
  }

  await runAuthorizedGcFormsWrite(context, async trx => {
    let currentConfig: GcsGcFormsStreamConfig
    try {
      currentConfig = await getStreamConfig(trx, streamId)
    }
    catch {
      throw createGcFormsConfigChangedError()
    }
    const currentCredentialId = assertConfiguredCredential(currentConfig)
    const currentConnection = await findCurrentGcFormsConnection(trx, streamId, currentConfig)
    if (!currentConnection) {
      throw createGcFormsConfigChangedError()
    }
    const currentCredentialIdentity = await getGcFormsCredentialSessionIdentity(
      trx,
      currentConnection.agency_id,
      currentCredentialId
    )
    const currentSession = createSyncSessionIdentity(
      currentConfig,
      String(currentConnection.id),
      currentCredentialIdentity
    )
    if (
      currentSession.configFingerprint !== expectedSession.configFingerprint
      || currentSession.connectionId !== expectedSession.connectionId
      || currentSession.credentialId !== expectedSession.credentialId
      || currentSession.credentialRevision !== expectedSession.credentialRevision
      || currentSession.secretEntryId !== expectedSession.secretEntryId
      || currentSession.secretUpdatedAt !== expectedSession.secretUpdatedAt
    ) {
      throw createGcFormsConfigChangedError()
    }
    await updateStreamTemplateShapeChanged(trx, streamId, true)
  }, streamId)
}

/** Rejects templates that omit any questions required for claim materialization. */
const assertGcFormsClaimTemplateShape = (template: unknown) => {
  const missingQuestionIds = getMissingGcFormsClaimQuestionIds(template)
  if (missingQuestionIds.length > 0) {
    throw createGcsExtensionUserError({
      statusCode: 409,
      code: 'GCS_GCFORMS_TEMPLATE_UNSUPPORTED',
      message: {
        en: `The GC Forms template is missing required claim fields: ${missingQuestionIds.join(', ')}.`,
        fr: `Le modele GC Forms ne contient pas les champs de reclamation requis : ${missingQuestionIds.join(', ')}.`
      },
      details: missingQuestionIds.map(questionId => ({
        path: questionId,
        code: 'missing_question_id',
        message: {
          en: `Missing required GC Forms question: ${questionId}.`,
          fr: `Question GC Forms requise manquante : ${questionId}.`
        }
      }))
    })
  }
}

/** Blocks synchronization until a stored template exists and still matches the remote template shape. */
const assertGcFormsTemplateShapeUnchanged = async (
  db: GcFormsIntegrationDb,
  connectionId: string,
  currentTemplate: unknown,
  sessionIdentity: GcFormsSyncSessionIdentity
) => {
  const stored = await db
    .selectFrom('extensions.gcs_gcforms_templates')
    .select('template')
    .where('connection_id', '=', connectionId)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  if (!stored) {
    throw createGcsExtensionUserError({
      statusCode: 409,
      code: 'GCS_GCFORMS_TEMPLATE_NOT_REVIEWED',
      message: {
        en: 'Refresh and review the GC Forms template before syncing submissions.',
        fr: 'Actualisez et verifiez le modele GC Forms avant de synchroniser les soumissions.'
      }
    })
  }

  if (!gcFormsTemplateShapesEqual(stored.template, currentTemplate)) {
    const templateChangedError = createGcsExtensionUserError({
      statusCode: 409,
      code: 'GCS_GCFORMS_TEMPLATE_CHANGED',
      message: {
        en: 'The GC Forms template has changed since it was last reviewed. Refresh the template, review the mappings, save the stream configuration, and sync again.',
        fr: 'Le modele GC Forms a change depuis sa derniere verification. Actualisez le modele, verifiez les correspondances, enregistrez la configuration du volet, puis synchronisez de nouveau.'
      }
    })
    throw Object.assign(templateChangedError, {
      gcFormsSyncSession: sessionIdentity
    }) satisfies GcFormsTemplateChangedError
  }
}

const createGcFormsImportRun = async (
  db: GcFormsIntegrationDb,
  connectionId: string,
  integrationId: string
): Promise<ImportRunRow> => {
  return await db
    .insertInto('extensions.gcs_gcforms_import_runs')
    .values({
      connection_id: connectionId,
      integration_id: integrationId,
      status: 'running',
      discovered_count: 0,
      imported_count: 0,
      problem_count: 0
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

/** Inserts a newly discovered submission or returns its existing active record after a conflict. */
const getOrCreateGcFormsSubmission = async (
  db: GcFormsIntegrationDb,
  connection: ConnectionRow,
  integrationId: string,
  submission: GcFormsNewSubmission
): Promise<SubmissionRow> => {
  const inserted = await db
    .insertInto('extensions.gcs_gcforms_submissions')
    .values({
      connection_id: String(connection.id),
      integration_id: integrationId,
      form_id: connection.form_id,
      submission_name: submission.name,
      gcforms_created_at: new Date(submission.createdAt),
      status: 'discovered'
    })
    .onConflict(oc => oc
      .columns(['connection_id', 'submission_name'])
      .where('_deleted', '=', false)
      .doNothing()
    )
    .returningAll()
    .executeTakeFirst()

  if (inserted) {
    return inserted
  }

  return await db
    .selectFrom('extensions.gcs_gcforms_submissions')
    .selectAll()
    .where('connection_id', '=', String(connection.id))
    .where('submission_name', '=', submission.name)
    .where('_deleted', '=', false)
    .executeTakeFirstOrThrow()
}

/** Maps preview and materialization outcomes to the persisted submission import status. */
const resolveGcFormsSubmissionImportStatus = (
  previewIssueCount: number,
  materializationStatus: string
): GcFormsSubmissionStatus => {
  if (previewIssueCount > 0) {
    return 'mapping_failed'
  }

  if (materializationStatus === 'failed') {
    return 'materialization_failed'
  }

  if (materializationStatus === 'already_materialized') {
    return 'skipped'
  }

  if (materializationStatus === 'created') {
    return 'imported'
  }

  return 'mapped'
}

/** Soft-deletes previous attachment records and stores the attachments from the latest decrypted submission. */
const replaceGcFormsSubmissionAttachments = async (
  db: GcFormsIntegrationDb,
  submissionId: string,
  decrypted: GcFormsDecryptedSubmission
) => {
  await db
    .updateTable('extensions.gcs_gcforms_attachments')
    .set({ _deleted: true })
    .where('submission_id', '=', submissionId)
    .where('_deleted', '=', false)
    .execute()

  if (!decrypted.attachments?.length) {
    return
  }

  await db
    .insertInto('extensions.gcs_gcforms_attachments')
    .values(decrypted.attachments.map(attachment => ({
      submission_id: submissionId,
      gcforms_attachment_id: attachment.id ?? null,
      file_name: attachment.name,
      source_url: attachment.downloadLink,
      storage_path: null,
      md5: attachment.md5 ?? null,
      is_potentially_malicious: attachment.isPotentiallyMalicious
    })))
    .execute()
}

const updateGcFormsSubmissionProblem = async (
  db: GcFormsIntegrationDb,
  submissionId: string,
  diagnostic = 'GC Forms submission processing failed.'
) => {
  await db
    .updateTable('extensions.gcs_gcforms_submissions')
    .set({
      status: 'problem',
      last_error: diagnostic,
      updated_at: new Date()
    })
    .where('id', '=', submissionId)
    .execute()
}

const createGcFormsAgreementUnavailableError = () => createGcsExtensionUserError({
  statusCode: 403,
  code: 'GCS_GCFORMS_AGREEMENT_UPDATE_FORBIDDEN',
  message: {
    en: 'The resolved agreement is no longer available for this import.',
    fr: 'L entente resolue n est plus disponible pour cette importation.'
  }
})

/** Decrypts, verifies, maps, materializes, stores, and optionally confirms one discovered submission. */
const importGcFormsSubmission = async (
  context: SyncSubmissionContext,
  submission: GcFormsNewSubmission,
  decrypted: GcFormsDecryptedSubmission
): Promise<{
  outcome: 'imported' | 'problem' | 'skipped'
  pendingConfirmationId?: string
}> => {
  const row = await getOrCreateGcFormsSubmission(
    context.db,
    context.connection,
    String(context.integration.id),
    submission
  )
  const submissionId = String(row.id)

  if (row.status === 'imported_pending_confirm') {
    return {
      outcome: 'skipped',
      pendingConfirmationId: submissionId
    }
  }

  try {
    if (!verifyGcFormsIntegrity(decrypted.answers, decrypted.checksum)) {
      throw new Error('GC Forms checksum verification failed')
    }

    const answers = normalizeGcFormsAnswers(decrypted.answers, context.currentTemplate)
    answers.__gcforms_created_at = new Date(decrypted.createdAt).toISOString()
    const preparedMaterialization = prepareGcFormsSubmissionMaterialization(answers, context.config.mappings)
    const materialization = preparedMaterialization.materializationIssues.length > 0
      ? {
          status: 'failed' as const,
          lineItemIds: [],
          issues: preparedMaterialization.materializationIssues
        }
      : preparedMaterialization.previewIssues.length === 0
      ? await materializeGcFormsClaimSubmission(context.db, {
          agencyId: String(context.connection.agency_id),
          streamId: context.streamId,
          integrationId: String(context.integration.id),
          submissionId,
          submissionUuid: submission.name,
          submissionStatusId: assertConfiguredSubmissionStatus(context.config),
          mappings: context.config.mappings,
          mappedValues: preparedMaterialization.values,
          authorizeAgreementUpdate: context.authorizeAgreementUpdate
        })
      : {
          status: 'failed' as const,
          lineItemIds: [],
          issues: []
        }
    const issues = [...preparedMaterialization.previewIssues, ...materialization.issues]
    const finalStatus = resolveGcFormsSubmissionImportStatus(
      preparedMaterialization.previewIssues.length,
      materialization.status
    )
    const shouldConfirm = shouldConfirmGcFormsSubmission(
      context.config.confirmSubmissions,
      materialization.status,
      issues
      )

    await context.db
      .updateTable('extensions.gcs_gcforms_submissions')
      .set({
        integration_id: String(context.integration.id),
        status: shouldConfirm ? 'imported_pending_confirm' : finalStatus,
        confirmation_code: decrypted.confirmationCode,
        answers: gcFormsJsonbValue(answers),
        answers_checksum: decrypted.checksum,
        mapped_values: gcFormsJsonbValue(preparedMaterialization.values),
        mapping_issues: gcFormsJsonbValue(issues),
        last_error: issues[0]?.message ?? null,
        updated_at: new Date()
      })
      .where('id', '=', submissionId)
      .execute()

    await replaceGcFormsSubmissionAttachments(context.db, submissionId, decrypted)

    if (issues.length > 0) {
      return { outcome: 'problem' }
    }

    const importResult = materialization.status === 'already_materialized' ? 'skipped' : 'imported'
    if (shouldConfirm) {
      return {
        outcome: importResult,
        pendingConfirmationId: submissionId
      }
    }

    return { outcome: importResult }
  } catch (error) {
    const diagnostic = isGcsExtensionUserError(error)
      && error.code.startsWith('GCS_GCFORMS_SUBMISSION_STATUS_')
      ? `GC Forms submission status configuration is invalid (${error.code}).`
      : undefined
    await updateGcFormsSubmissionProblem(context.db, submissionId, diagnostic)
    return { outcome: 'problem' }
  }
}

/** Finalizes local submission state only after its remote confirmation succeeds. */
export const finalizeGcFormsSubmissionConfirmation = async (
  rawDb: unknown,
  submissionId: string,
  finalStatus: GcFormsSubmissionStatus
): Promise<void> => {
  await asGcFormsIntegrationDb(rawDb)
    .updateTable('extensions.gcs_gcforms_submissions')
    .set({ status: finalStatus, updated_at: new Date() })
    .where('id', '=', submissionId)
    .where('_deleted', '=', false)
    .execute()
}

const finishGcFormsImportRun = async (
  db: GcFormsIntegrationDb,
  runId: string,
  submissions: GcFormsNewSubmission[],
  importedCount: number,
  problemCount: number
) => {
  await db
    .updateTable('extensions.gcs_gcforms_import_runs')
    .set({
      status: 'completed',
      finished_at: new Date(),
      discovered_count: submissions.length,
      imported_count: importedCount,
      problem_count: problemCount
    })
    .where('id', '=', runId)
    .execute()
}

/** Marks an import run failed with its final counts and normalized error message. */
const failGcFormsImportRun = async (
  db: GcFormsIntegrationDb,
  runId: string,
  submissions: GcFormsNewSubmission[],
  importedCount: number,
  problemCount: number
) => {
  await db
    .updateTable('extensions.gcs_gcforms_import_runs')
    .set({
      status: 'failed',
      finished_at: new Date(),
      discovered_count: submissions.length,
      imported_count: importedCount,
      problem_count: problemCount,
      error_message: 'GC Forms synchronization failed.'
    })
    .where('id', '=', runId)
    .execute()
}

type PendingConfirmationDiscovery = {
  submissionId: string
  remotelyPending: boolean
}

type HistoricalPendingRow = {
  id: string
  submission_name: string
  connection_id: string
  agency_id: string
  credential_id: string
  credential_revision: number
  secret_entry_id: string
  secret_updated_at: Date | string
  form_id: string
  api_url: string
  identity_provider_url: string
  project_identifier: string
}

const assertCurrentSyncSession = async (
  db: GcFormsIntegrationDb,
  streamId: string,
  expectedSession: GcFormsSyncSessionIdentity
): Promise<GcsGcFormsStreamConfig> => {
  const currentConfig = await getStreamConfig(db, streamId)
  const currentCredentialId = assertConfiguredCredential(currentConfig)
  const currentConnection = await findCurrentGcFormsConnection(db, streamId, currentConfig)
  if (!currentConnection) {
    throw createGcFormsConfigChangedError()
  }
  const credentialIdentity = await getGcFormsCredentialSessionIdentity(
    db,
    currentConnection.agency_id,
    currentCredentialId
  )
  const currentSession = createSyncSessionIdentity(
    currentConfig,
    String(currentConnection.id),
    credentialIdentity
  )
  if (
    currentSession.configFingerprint !== expectedSession.configFingerprint
    || currentSession.connectionId !== expectedSession.connectionId
    || currentSession.credentialId !== expectedSession.credentialId
    || currentSession.credentialRevision !== expectedSession.credentialRevision
    || currentSession.secretEntryId !== expectedSession.secretEntryId
    || currentSession.secretUpdatedAt !== expectedSession.secretUpdatedAt
  ) {
    throw createGcFormsConfigChangedError()
  }
  return currentConfig
}

const createHistoricalConnectionClient = async (
  rawDb: unknown,
  connection: Pick<HistoricalPendingRow, 'agency_id' | 'credential_id' | 'credential_revision' | 'secret_entry_id' | 'secret_updated_at' | 'form_id' | 'api_url' | 'identity_provider_url' | 'project_identifier'>
): Promise<GcFormsApiClient> => {
  const { credential, identity } = await getGcFormsCredentialState(
    rawDb,
    connection.agency_id,
    connection.credential_id
  )
  if (
    identity.credentialRevision !== connection.credential_revision
    || identity.secretEntryId !== String(connection.secret_entry_id)
    || identity.secretUpdatedAt !== timestampIdentity(connection.secret_updated_at)
  ) {
    throw createGcsExtensionUserError({
      statusCode: 409,
      code: 'GCS_GCFORMS_HISTORICAL_CREDENTIAL_CHANGED',
      message: {
        en: 'The credential used by this pending GC Forms submission has changed.',
        fr: 'Le justificatif utilise par cette soumission GC Forms en attente a change.'
      }
    })
  }
  return new GcFormsApiClient({
    apiUrl: connection.api_url,
    identityProviderUrl: connection.identity_provider_url,
    projectIdentifier: connection.project_identifier,
    privateApiKey: {
      ...credential,
      formId: connection.form_id
    }
  })
}

const getHistoricalPendingConfirmations = async (
  db: GcFormsIntegrationDb,
  streamId: string
): Promise<HistoricalPendingRow[]> => await db
  .selectFrom('extensions.gcs_gcforms_submissions as submission')
  .innerJoin(
    'extensions.gcs_gcforms_connections as connection',
    'connection.id',
    'submission.connection_id'
  )
  .select([
    'submission.id as id',
    'submission.submission_name as submission_name',
    'submission.connection_id as connection_id',
    'connection.agency_id as agency_id',
    'connection.credential_id as credential_id',
    'connection.credential_revision as credential_revision',
    'connection.secret_entry_id as secret_entry_id',
    'connection.secret_updated_at as secret_updated_at',
    'connection.form_id as form_id',
    'connection.api_url as api_url',
    'connection.identity_provider_url as identity_provider_url',
    'connection.project_identifier as project_identifier'
  ])
  .where('connection.stream_id', '=', streamId)
  .where('submission.status', '=', 'imported_pending_confirm')
  .where('submission._deleted', '=', false)
  .execute() as HistoricalPendingRow[]

/** Finalizes pending rows locally before remote preparation when confirmation is currently disabled. */
export const reconcileDisabledGcFormsConfirmations = async (
  context: GcsExtensionRouteContext,
  streamId: string
): Promise<number> => await runAuthorizedGcFormsWrite(context, async trx => {
  const { config } = await resolveStreamConfig(trx, streamId)
  if (config.confirmSubmissions) {
    return 0
  }

  const pendingRows = await trx
    .selectFrom('extensions.gcs_gcforms_submissions as submission')
    .innerJoin(
      'extensions.gcs_gcforms_connections as connection',
      'connection.id',
      'submission.connection_id'
    )
    .select('submission.id')
    .where('connection.stream_id', '=', streamId)
    .where('submission.status', '=', 'imported_pending_confirm')
    .where('submission._deleted', '=', false)
    .forUpdate('submission')
    .execute()
  if (pendingRows.length === 0) {
    return 0
  }

  const pendingIds = pendingRows.map(row => String(row.id))
  await trx
    .updateTable('extensions.gcs_gcforms_submissions')
    .set({ status: 'imported', updated_at: new Date() })
    .where('id', 'in', pendingIds)
    .where('status', '=', 'imported_pending_confirm')
    .where('_deleted', '=', false)
    .execute()
  return pendingIds.length
}, streamId)

/** Re-authorizes and reconciles one durable pending confirmation using its historical connection. */
export const reconcileGcFormsSubmissionConfirmation = async (
  context: GcsExtensionRouteContext,
  streamId: string,
  pending: PendingConfirmationDiscovery
): Promise<void> => {
  const remoteConfirmation = await runAuthorizedGcFormsWrite(context, async trx => {
    const row = await trx
      .selectFrom('extensions.gcs_gcforms_submissions as submission')
      .innerJoin(
        'extensions.gcs_gcforms_connections as connection',
        'connection.id',
        'submission.connection_id'
      )
      .innerJoin(
        'extensions.gcs_gcforms_integrations as integration',
        'integration.id',
        'submission.integration_id'
      )
      .select([
        'submission.id as id',
        'submission.submission_name as submission_name',
        'submission.confirmation_code as confirmation_code',
        'connection.agency_id as agency_id',
        'connection.credential_id as credential_id',
        'connection.credential_revision as credential_revision',
        'connection.secret_entry_id as secret_entry_id',
        'connection.secret_updated_at as secret_updated_at',
        'connection.form_id as form_id',
        'connection.api_url as api_url',
        'connection.identity_provider_url as identity_provider_url',
        'connection.project_identifier as project_identifier',
        'integration.config as integration_config'
      ])
      .where('submission.id', '=', pending.submissionId)
      .where('connection.stream_id', '=', streamId)
      .where('submission.status', '=', 'imported_pending_confirm')
      .where('submission._deleted', '=', false)
      .executeTakeFirst()
    if (!row) {
      return null
    }

    const persistedConfig = parseGcFormsStreamConfig(row.integration_config)
    if (!persistedConfig.confirmSubmissions || !pending.remotelyPending) {
      await finalizeGcFormsSubmissionConfirmation(trx, pending.submissionId, 'imported')
      return null
    }
    const confirmationCode = row.confirmation_code
    if (!confirmationCode) {
      throw new Error('Pending GC Forms confirmation is missing its confirmation code.')
    }

    return { ...row, confirmation_code: confirmationCode }
  }, streamId)

  if (!remoteConfirmation) {
    return
  }

  const client = await createHistoricalConnectionClient(context.db, remoteConfirmation)
  await client.confirmSubmission(remoteConfirmation.submission_name, remoteConfirmation.confirmation_code)

  await runAuthorizedGcFormsWrite(context, async trx => {
    const current = await trx
      .selectFrom('extensions.gcs_gcforms_submissions as submission')
      .innerJoin(
        'extensions.gcs_gcforms_connections as connection',
        'connection.id',
        'submission.connection_id'
      )
      .select('submission.id')
      .where('submission.id', '=', pending.submissionId)
      .where('connection.stream_id', '=', streamId)
      .where('submission.status', '=', 'imported_pending_confirm')
      .where('submission.confirmation_code', '=', remoteConfirmation.confirmation_code)
      .where('submission._deleted', '=', false)
      .forUpdate('submission')
      .executeTakeFirst()
    if (current) {
      await finalizeGcFormsSubmissionConfirmation(trx, pending.submissionId, 'imported')
    }
  }, streamId)
}

/** Synchronizes remote data outside locks and commits only short re-authorized local batches. */
export const syncStream = async (
  context: GcsExtensionRouteContext,
  streamId: string
) => {
  await reconcileDisabledGcFormsConfirmations(context, streamId)
  const session = await runAuthorizedGcFormsWrite(context, async trx => {
    const config = await getStreamConfig(trx, streamId)
    const connection = await ensureConnection(trx, streamId, config)
    const integration = await ensureIntegration(trx, streamId, String(connection.id), config)
    return { config, connection, integration }
  }, streamId)
  const db = asGcFormsIntegrationDb(context.db)
  const { client, credentialIdentity } = await createConfiguredClientSession(db, streamId, session.config)
  const sessionIdentity = createSyncSessionIdentity(
    session.config,
    String(session.connection.id),
    credentialIdentity
  )
  const currentTemplate = await client.getFormTemplate()
  assertGcFormsClaimTemplateShape(currentTemplate)
  await assertGcFormsTemplateShapeUnchanged(
    db,
    String(session.connection.id),
    currentTemplate,
    sessionIdentity
  )
  const submissions = await client.getNewSubmissions()
  const historicalPending = await getHistoricalPendingConfirmations(db, streamId)
  const currentPendingNames = new Set(
    historicalPending
      .filter(pending => String(pending.connection_id) === String(session.connection.id))
      .map(pending => pending.submission_name)
  )
  const decryptedSubmissions = new Map<string, GcFormsDecryptedSubmission>()
  for (const submission of submissions) {
    if (currentPendingNames.has(submission.name)) {
      continue
    }
    decryptedSubmissions.set(submission.name, await client.getDecryptedSubmission(submission.name))
  }

  const remoteNamesByConnection = new Map<string, Set<string>>([
    [String(session.connection.id), new Set(submissions.map(submission => submission.name))]
  ])
  for (const pending of historicalPending) {
    const pendingConnectionId = String(pending.connection_id)
    if (remoteNamesByConnection.has(pendingConnectionId)) {
      continue
    }
    const historicalClient = await createHistoricalConnectionClient(db, pending)
    const historicalSubmissions = await historicalClient.getNewSubmissions()
    remoteNamesByConnection.set(
      pendingConnectionId,
      new Set(historicalSubmissions.map(submission => submission.name))
    )
  }

  const run = await runAuthorizedGcFormsWrite(context, async trx => {
    await assertCurrentSyncSession(trx, streamId, sessionIdentity)
    return await createGcFormsImportRun(
      trx,
      String(session.connection.id),
      String(session.integration.id)
    )
  }, streamId)
  let importedCount = 0
  let skippedCount = 0
  let problemCount = 0
  const pendingConfirmations = new Map<string, PendingConfirmationDiscovery>()
  for (const pending of historicalPending) {
    pendingConfirmations.set(String(pending.id), {
      submissionId: String(pending.id),
      remotelyPending: remoteNamesByConnection.get(String(pending.connection_id))?.has(pending.submission_name) === true
    })
  }

  try {
    for (const submission of submissions) {
      if (currentPendingNames.has(submission.name)) {
        skippedCount += 1
        continue
      }
      const decrypted = decryptedSubmissions.get(submission.name)
      if (!decrypted) {
        throw new Error('Prepared GC Forms submission data was not found.')
      }
      const result = await runAuthorizedGcFormsWrite(context, async trx => {
        const config = await assertCurrentSyncSession(
          trx,
          streamId,
          sessionIdentity
        )
        return await importGcFormsSubmission({
          db: trx,
          streamId,
          connection: session.connection,
          integration: session.integration,
          config,
          currentTemplate,
          authorizeAgreementUpdate: async agreementId => {
            const lockAndAuthorizeAgreement = context.writeAuthorization?.lockAndAuthorizeAgreement
            if (!lockAndAuthorizeAgreement) {
              throw new Error('GC Forms claim imports require host-provided agreement write authorization.')
            }
            const available = await lockAndAuthorizeAgreement(trx, {
              agreementId,
              streamId,
              action: 'update'
            })
            if (!available) {
              throw createGcFormsAgreementUnavailableError()
            }
          }
        }, submission, decrypted)
      }, streamId)
      if (result.pendingConfirmationId) {
        pendingConfirmations.set(result.pendingConfirmationId, {
          submissionId: result.pendingConfirmationId,
          remotelyPending: true
        })
      }
      if (result.outcome === 'problem') {
        problemCount += 1
      } else if (result.outcome === 'skipped') {
        skippedCount += 1
      } else {
        importedCount += 1
      }
    }

    await runAuthorizedGcFormsWrite(context, async trx => {
      await assertCurrentSyncSession(trx, streamId, sessionIdentity)
      await finishGcFormsImportRun(trx, String(run.id), submissions, importedCount, problemCount)
    }, streamId)
  } catch (error: unknown) {
    await runAuthorizedGcFormsWrite(context, async trx => {
      await failGcFormsImportRun(trx, String(run.id), submissions, importedCount, problemCount)
    }, streamId)
    throw error
  }

  return {
    runId: String(run.id),
    discovered: submissions.length,
    imported: importedCount,
    skipped: skippedCount,
    problems: problemCount,
    pendingConfirmations: [...pendingConfirmations.values()]
  }
}
