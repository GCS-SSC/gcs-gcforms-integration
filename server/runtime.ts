import { sql, type Selectable } from 'kysely'
import type { JsonValue } from '@gcs-ssc/extensions'
import {
  createGcsExtensionUserError,
  getEncryptedExtensionSecret,
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
  previewGcFormsMapping,
  type GcsGcFormsStreamConfig,
  type GcFormsDecryptedSubmission,
  type GcFormsNewSubmission,
  type GcFormsPrivateApiKey
} from '../shared/gcforms.ts'
import { GcFormsApiClient, verifyGcFormsIntegrity } from './gcforms-client.ts'
import {
  asGcFormsIntegrationDb,
  type GcFormsIntegrationDb,
  type GcFormsIntegrationHostDatabase
} from './db.ts'
import { gcFormsJsonbValue } from './jsonb.ts'
import { materializeGcFormsClaimSubmission } from './materialize-claims.ts'

type ConnectionRow = Selectable<
  GcFormsIntegrationHostDatabase['extensions.gcs_gcforms_connections']
>

type CredentialRow = {
  id: string
  agency_id: string
  key_id: string
  user_id: string
  form_id: string
}

type IntegrationRow = Selectable<
  GcFormsIntegrationHostDatabase['extensions.gcs_gcforms_integrations']
>

type ImportRunRow = {
  id: string
}

type SubmissionRow = {
  id: string
}

type SyncSubmissionContext = {
  rawDb: unknown
  db: GcFormsIntegrationDb
  client: Pick<GcFormsApiClient, 'getDecryptedSubmission' | 'confirmSubmission'>
  streamId: string
  connection: ConnectionRow
  integration: IntegrationRow
  config: GcsGcFormsStreamConfig
  currentTemplate: unknown
}

const maybeString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

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

/** Loads credential metadata and decrypts its private API key for an agency. */
export const getGcFormsCredential = async (
  rawDb: unknown,
  agencyId: string,
  credentialId: string
): Promise<GcFormsPrivateApiKey> => {
  const db = asGcFormsIntegrationDb(rawDb)
  const row = await db
    .selectFrom('extensions.gcs_gcforms_credentials')
    .select(['id', 'agency_id', 'key_id', 'user_id', 'form_id'])
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

  const credential = await getEncryptedExtensionSecret<GcFormsIntegrationHostDatabase>(db, {
    rootKey: getGcFormsSecretRootKey(),
    extensionKey: GCFORMS_EXTENSION_KEY,
    ownerType: 'agency',
    ownerId: agencyId,
    secretKey: String(row.id)
  })
  if (!credential) {
    throw createGcsExtensionUserError({
      statusCode: 400,
      code: 'GCS_GCFORMS_CREDENTIAL_MISSING',
      message: {
        en: 'The selected GC Forms credential is not available on the server.',
        fr: 'Le justificatif GC Forms selectionne n est pas disponible sur le serveur.'
      }
    })
  }

  const secret = GcFormsCredentialSecretSchema.parse(credential)
  return {
    keyId: row.key_id,
    key: secret.key,
    userId: row.user_id,
    formId: row.form_id
  }
}

/** Loads active credential metadata and rejects credentials outside the requested agency. */
const getGcFormsCredentialRow = async (
  db: GcFormsIntegrationDb,
  agencyId: string,
  credentialId: string
): Promise<CredentialRow> => {
  const row = await db
    .selectFrom('extensions.gcs_gcforms_credentials')
    .select(['id', 'agency_id', 'key_id', 'user_id', 'form_id'])
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

/** Authorizes direct or inherited team access to a stream's GC Forms integration. */
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

  const canAccessWithTeam = await authContext.userAbilities.authorizeWithTeam(
    'transfer_payment',
    action,
    streamContext.scope,
    authContext.userId,
    true,
    context.db
  )
  const canAccessScope = authContext.userAbilities.authorize('transfer_payment', action, streamContext.scope)

  if (!canAccessWithTeam && !canAccessScope) {
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

/** Resolves an enabled stream configuration, merging agency settings and validating its credential. */
export const getStreamConfig = async (
  db: GcFormsIntegrationDb,
  streamId: string
): Promise<GcsGcFormsStreamConfig> => {
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

  await getGcFormsCredentialRow(db, streamContext.agencyId, assertConfiguredCredential(config))

  return config
}

/** Returns the most recently stored template catalog and review state for a stream. */
export const getStoredTemplate = async (
  rawDb: unknown,
  streamId: string
) => {
  const db = asGcFormsIntegrationDb(rawDb)
  const config = await getStreamConfig(db, streamId)
  const connection = await db
    .selectFrom('extensions.gcs_gcforms_connections')
    .select(['id'])
    .where('stream_id', '=', streamId)
    .where('credential_id', '=', assertConfiguredCredential(config))
    .where('_deleted', '=', false)
    .executeTakeFirst()
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

/** Synchronizes an existing connection with the current stream configuration and credential metadata. */
const updateConnection = async (
  db: GcFormsIntegrationDb,
  id: string,
  config: GcsGcFormsStreamConfig,
  credential: CredentialRow
) => {
  return await db
    .updateTable('extensions.gcs_gcforms_connections')
    .set({
      credential_id: assertConfiguredCredential(config),
      form_id: credential.form_id,
      api_url: config.apiUrl || DEFAULT_GCFORMS_API_URL,
      identity_provider_url: config.identityProviderUrl || DEFAULT_GCFORMS_IDP_URL,
      project_identifier: config.projectIdentifier || DEFAULT_GCFORMS_PROJECT_IDENTIFIER,
      contact_email: config.contactEmail || null,
      preferred_language: config.preferredLanguage,
      updated_at: new Date()
    })
    .where('id', '=', sql<string>`${String(id)}::bigint`)
    .returningAll()
    .executeTakeFirstOrThrow()
}

/** Returns an updated active connection or creates one for the stream's configured credential. */
export const ensureConnection = async (
  rawDb: unknown,
  streamId: string,
  config: GcsGcFormsStreamConfig
): Promise<ConnectionRow> => {
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
  const credential = await getGcFormsCredentialRow(db, streamContext.agencyId, assertConfiguredCredential(config))

  const existing = await db
    .selectFrom('extensions.gcs_gcforms_connections')
    .selectAll()
    .where('stream_id', '=', streamId)
    .where('credential_id', '=', String(credential.id))
    .where('_deleted', '=', false)
    .executeTakeFirst()

  if (existing) {
    return await updateConnection(db, existing.id, config, credential)
  }

  return await db
    .insertInto('extensions.gcs_gcforms_connections')
    .values({
      agency_id: streamContext.agencyId,
      stream_id: streamId,
      credential_id: String(credential.id),
      form_id: credential.form_id,
      api_url: config.apiUrl || DEFAULT_GCFORMS_API_URL,
      identity_provider_url: config.identityProviderUrl || DEFAULT_GCFORMS_IDP_URL,
      project_identifier: config.projectIdentifier || DEFAULT_GCFORMS_PROJECT_IDENTIFIER,
      contact_email: config.contactEmail || null,
      preferred_language: config.preferredLanguage,
      status: 'active'
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

/** Upserts the stream integration and replaces its persisted field mappings with the current configuration. */
export const ensureIntegration = async (
  rawDb: unknown,
  streamId: string,
  connectionId: string,
  config: GcsGcFormsStreamConfig
): Promise<IntegrationRow> => {
  const db = asGcFormsIntegrationDb(rawDb)
  const existing = await db
    .selectFrom('extensions.gcs_gcforms_integrations')
    .selectAll()
    .where('connection_id', '=', connectionId)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  const values = {
    name_en: 'GC Forms integration',
    name_fr: 'Integration GC Forms',
    enabled: true,
    config: gcFormsJsonbValue(config),
    updated_at: new Date()
  }

  const integration = existing
    ? await db
        .updateTable('extensions.gcs_gcforms_integrations')
        .set(values)
        .where('id', '=', String(existing.id))
        .returningAll()
        .executeTakeFirstOrThrow()
    : await db
        .insertInto('extensions.gcs_gcforms_integrations')
        .values({
          connection_id: connectionId,
          stream_id: streamId,
          name_en: values.name_en,
          name_fr: values.name_fr,
          enabled: true,
          config: gcFormsJsonbValue(config)
        })
        .returningAll()
        .executeTakeFirstOrThrow()

  await db
    .updateTable('extensions.gcs_gcforms_field_mappings')
    .set({ _deleted: true })
    .where('integration_id', '=', sql<string>`${String(integration.id)}::bigint`)
    .where('_deleted', '=', false)
    .execute()

  if (config.mappings.length > 0) {
    await db
      .insertInto('extensions.gcs_gcforms_field_mappings')
      .values(config.mappings.map(mapping => ({
        integration_id: String(integration.id),
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

  return integration
}

/** Creates a GC Forms API client from the stream's agency credential and connection settings. */
export const createConfiguredClient = async (
  rawDb: unknown,
  streamId: string,
  config: GcsGcFormsStreamConfig
): Promise<GcFormsApiClient> => {
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

  const credential = await getGcFormsCredential(db, streamContext.agencyId, credentialId)
  return new GcFormsApiClient({
    apiUrl: config.apiUrl,
    identityProviderUrl: config.identityProviderUrl,
    projectIdentifier: config.projectIdentifier,
    privateApiKey: {
      ...credential
    }
  })
}

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
const updateStreamTemplateShapeChanged = async (
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
  streamId: string,
  connectionId: string,
  currentTemplate: unknown
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
    await updateStreamTemplateShapeChanged(db, streamId, true)
    throw createGcsExtensionUserError({
      statusCode: 409,
      code: 'GCS_GCFORMS_TEMPLATE_CHANGED',
      message: {
        en: 'The GC Forms template has changed since it was last reviewed. Refresh the template, review the mappings, save the stream configuration, and sync again.',
        fr: 'Le modele GC Forms a change depuis sa derniere verification. Actualisez le modele, verifiez les correspondances, enregistrez la configuration du volet, puis synchronisez de nouveau.'
      }
    })
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
) => {
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
  error: unknown
) => {
  await db
    .updateTable('extensions.gcs_gcforms_submissions')
    .set({
      status: 'problem',
      last_error: error instanceof Error ? error.message : String(error),
      updated_at: new Date()
    })
    .where('id', '=', submissionId)
    .execute()
}

/** Decrypts, verifies, maps, materializes, stores, and optionally confirms one discovered submission. */
const importGcFormsSubmission = async (
  context: SyncSubmissionContext,
  submission: GcFormsNewSubmission
): Promise<'imported' | 'problem' | 'skipped'> => {
  const row = await getOrCreateGcFormsSubmission(
    context.db,
    context.connection,
    String(context.integration.id),
    submission
  )
  const submissionId = String(row.id)

  try {
    const decrypted = await context.client.getDecryptedSubmission(submission.name)
    if (!verifyGcFormsIntegrity(decrypted.answers, decrypted.checksum)) {
      throw new Error('GC Forms checksum verification failed')
    }

    const answers = normalizeGcFormsAnswers(decrypted.answers, context.currentTemplate)
    answers.__gcforms_created_at = new Date(decrypted.createdAt).toISOString()
    const preview = previewGcFormsMapping(answers, context.config.mappings)
    const materialization = preview.issues.length === 0
      ? await materializeGcFormsClaimSubmission(context.rawDb, {
          streamId: context.streamId,
          integrationId: String(context.integration.id),
          submissionId,
          submissionUuid: submission.name,
          mappings: context.config.mappings,
          mappedValues: preview.values
        })
      : {
          status: 'failed' as const,
          lineItemIds: [],
          issues: []
        }
    const issues = [...preview.issues, ...materialization.issues]
    const status = resolveGcFormsSubmissionImportStatus(preview.issues.length, materialization.status)

    await context.db
      .updateTable('extensions.gcs_gcforms_submissions')
      .set({
        integration_id: String(context.integration.id),
        status,
        confirmation_code: decrypted.confirmationCode,
        answers: gcFormsJsonbValue(answers),
        answers_checksum: decrypted.checksum,
        mapped_values: gcFormsJsonbValue(preview.values),
        mapping_issues: gcFormsJsonbValue(issues),
        last_error: issues[0]?.message ?? null,
        updated_at: new Date()
      })
      .where('id', '=', submissionId)
      .execute()

    await replaceGcFormsSubmissionAttachments(context.db, submissionId, decrypted)

    if (issues.length > 0) {
      return 'problem'
    }

    const importResult = materialization.status === 'already_materialized' ? 'skipped' : 'imported'
    if (importResult === 'imported' && context.config.confirmSubmissions) {
      await context.client.confirmSubmission(submission.name, decrypted.confirmationCode)
    }

    return importResult
  } catch (error: unknown) {
    await updateGcFormsSubmissionProblem(context.db, submissionId, error)
    return 'problem'
  }
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
  problemCount: number,
  error: unknown
) => {
  await db
    .updateTable('extensions.gcs_gcforms_import_runs')
    .set({
      status: 'failed',
      finished_at: new Date(),
      discovered_count: submissions.length,
      imported_count: importedCount,
      problem_count: problemCount,
      error_message: error instanceof Error ? error.message : String(error)
    })
    .where('id', '=', runId)
    .execute()
}

/** Synchronizes all new submissions for a stream and records aggregate import-run results. */
export const syncStream = async (
  rawDb: unknown,
  streamId: string
) => {
  const db = asGcFormsIntegrationDb(rawDb)
  const config = await getStreamConfig(db, streamId)
  const connection = await ensureConnection(rawDb, streamId, config)
  const client = await createConfiguredClient(rawDb, streamId, config)
  const currentTemplate = await client.getFormTemplate()
  assertGcFormsClaimTemplateShape(currentTemplate)
  await assertGcFormsTemplateShapeUnchanged(db, streamId, String(connection.id), currentTemplate)
  const integration = await ensureIntegration(rawDb, streamId, String(connection.id), config)
  const run = await createGcFormsImportRun(db, String(connection.id), String(integration.id))
  let importedCount = 0
  let skippedCount = 0
  let problemCount = 0
  const submissions = await client.getNewSubmissions()
  const syncContext: SyncSubmissionContext = {
    rawDb,
    db,
    client,
    streamId,
    connection,
    integration,
    config,
    currentTemplate
  }

  try {
    for (const submission of submissions) {
      const result = await importGcFormsSubmission(syncContext, submission)
      if (result === 'problem') {
        problemCount += 1
      } else if (result === 'skipped') {
        skippedCount += 1
      } else {
        importedCount += 1
      }
    }

    await finishGcFormsImportRun(db, String(run.id), submissions, importedCount, problemCount)
  } catch (error: unknown) {
    await failGcFormsImportRun(db, String(run.id), submissions, importedCount, problemCount, error)
    throw error
  }

  return {
    runId: String(run.id),
    discovered: submissions.length,
    imported: importedCount,
    skipped: skippedCount,
    problems: problemCount
  }
}
