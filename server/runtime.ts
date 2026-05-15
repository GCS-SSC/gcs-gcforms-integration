/* eslint-disable jsdoc/require-jsdoc */
import { sql } from 'kysely'
import {
  createGcsExtensionUserError,
  getEncryptedExtensionSecret,
  resolveExtensionStreamContext
} from '@gcs-ssc/extensions/server'
import type { H3Event } from 'h3'
import {
  DEFAULT_GCFORMS_API_URL,
  DEFAULT_GCFORMS_IDP_URL,
  DEFAULT_GCFORMS_PROJECT_IDENTIFIER,
  GCFORMS_EXTENSION_KEY,
  GcFormsPrivateApiKeySchema,
  gcFormsTemplateShapesEqual,
  normalizeGcFormsAnswers,
  normalizeGcFormsTemplate,
  parseGcFormsAgencyConfig,
  parseGcFormsStreamConfig,
  previewGcFormsMapping,
  type GcsGcFormsStreamConfig,
  type GcFormsPrivateApiKey
} from '../shared/gcforms'
import { GcFormsApiClient, verifyGcFormsIntegrity } from './gcforms-client'
import { asGcFormsIntegrationDb, type GcFormsIntegrationDb } from './db'
import { materializeGcFormsClaimSubmission } from './materialize-claims'

type HostDb = GcFormsIntegrationDb & {
  selectFrom: (table: string) => unknown
  insertInto: (table: string) => unknown
  updateTable: (table: string) => unknown
}

type StreamConfigurationRow = {
  enabled: boolean
  config: unknown
}

type AgencyEnablementRow = {
  config: unknown
}

type ConnectionRow = {
  id: string
  form_id: string
  credential_id: string
  api_url: string
  identity_provider_url: string
  project_identifier: string
  contact_email: string | null
  preferred_language: 'en' | 'fr'
}

type IntegrationRow = {
  id: string
  connection_id: string
  stream_id: string
  config: unknown
}

type ExtensionAuthContext = {
  userId: string
  userAbilities: {
    authorize: (subject: 'transfer_payment', action: 'read' | 'update', scope: unknown) => boolean
    authorizeWithTeam: (
      subject: 'transfer_payment',
      action: 'read' | 'update',
      scope: unknown,
      userId: string,
      includeInherited: boolean,
      db: unknown
    ) => Promise<boolean>
  }
}

type ExtensionRouteEvent = H3Event & {
  context: {
    $authContext?: ExtensionAuthContext
    $db: unknown
  }
}

const maybeString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const jsonbValue = (value: unknown) =>
  value === null || value === undefined
    ? null
    : sql`${JSON.stringify(value)}::jsonb`

const DEV_EXTENSION_SECRETS_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='

export const getGcFormsSecretRootKey = (): string => {
  const runtimeConfig = typeof useRuntimeConfig === 'function' ? useRuntimeConfig() : {}
  const key = runtimeConfig.extensionSecretsEncryptionKey ?? process.env.GCS_EXTENSION_SECRETS_KEY
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

export const getGcFormsCredential = async (
  rawDb: unknown,
  agencyId: string,
  credentialId: string
): Promise<GcFormsPrivateApiKey> => {
  const credential = await getEncryptedExtensionSecret(asGcFormsIntegrationDb(rawDb) as never, {
    rootKey: getGcFormsSecretRootKey(),
    extensionKey: GCFORMS_EXTENSION_KEY,
    ownerType: 'agency',
    ownerId: agencyId,
    secretKey: credentialId
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

  return GcFormsPrivateApiKeySchema.parse(credential)
}

export const authorizeGcFormsStream = async (
  event: ExtensionRouteEvent,
  streamId: string,
  action: 'read' | 'update'
): Promise<void> => {
  const authContext = event.context.$authContext
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

  const streamContext = await resolveExtensionStreamContext(event.context.$db as never, streamId)
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
    event.context.$db
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

export const getStreamConfig = async (
  db: HostDb,
  streamId: string
): Promise<GcsGcFormsStreamConfig> => {
  const streamContext = await resolveExtensionStreamContext(db as never, streamId)
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

  const row = await (db as never as {
    selectFrom: (table: 'extensions.stream_configuration') => {
      select: (columns: string[]) => {
        where: (...args: unknown[]) => {
          where: (...args: unknown[]) => {
            where: (...args: unknown[]) => {
              executeTakeFirst: () => Promise<StreamConfigurationRow | undefined>
            }
          }
        }
      }
    }
  })
    .selectFrom('extensions.stream_configuration')
    .select(['enabled', 'config'])
    .where('stream_id', '=', streamId)
    .where('extension_key', '=', GCFORMS_EXTENSION_KEY)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  const agencyRow = await (db as never as {
    selectFrom: (table: 'extensions.agency_enablement') => {
      select: (columns: string[]) => {
        where: (...args: unknown[]) => {
          where: (...args: unknown[]) => {
            where: (...args: unknown[]) => {
              where: (...args: unknown[]) => {
                executeTakeFirst: () => Promise<AgencyEnablementRow | undefined>
              }
            }
          }
        }
      }
    }
  })
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

  const agencyConfig = parseGcFormsAgencyConfig(agencyRow?.config)
  const config = parseGcFormsStreamConfig(row.config)
  config.apiUrl = agencyConfig.apiUrl || DEFAULT_GCFORMS_API_URL

  if (!config.credentialId || !config.formId) {
    throw createGcsExtensionUserError({
      statusCode: 400,
      code: 'GCS_GCFORMS_CONFIG_INCOMPLETE',
      message: {
        en: 'GC Forms credential and form ID are required before syncing.',
        fr: 'Le justificatif GC Forms et l identifiant du formulaire sont requis avant la synchronisation.'
      }
    })
  }

  return config
}

const updateConnection = async (
  db: GcFormsIntegrationDb,
  id: string,
  config: GcsGcFormsStreamConfig
) => await db
  .updateTable('extensions.gcs_gcforms_connections')
  .set({
    credential_id: config.credentialId!,
    form_id: config.formId!,
    api_url: config.apiUrl || DEFAULT_GCFORMS_API_URL,
    identity_provider_url: config.identityProviderUrl || DEFAULT_GCFORMS_IDP_URL,
    project_identifier: config.projectIdentifier || DEFAULT_GCFORMS_PROJECT_IDENTIFIER,
    contact_email: config.contactEmail || null,
    preferred_language: config.preferredLanguage,
    updated_at: new Date()
  })
  .where('id', '=', id)
  .returningAll()
  .executeTakeFirstOrThrow()

export const ensureConnection = async (
  rawDb: unknown,
  streamId: string,
  config: GcsGcFormsStreamConfig
): Promise<ConnectionRow> => {
  const db = asGcFormsIntegrationDb(rawDb)
  const streamContext = await resolveExtensionStreamContext(rawDb as never, streamId)
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

  const existing = await db
    .selectFrom('extensions.gcs_gcforms_connections')
    .selectAll()
    .where('stream_id', '=', streamId)
    .where('form_id', '=', config.formId!)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  if (existing) {
    return await updateConnection(db, String(existing.id), config) as ConnectionRow
  }

  return await db
    .insertInto('extensions.gcs_gcforms_connections')
    .values({
      agency_id: streamContext.agencyId,
      stream_id: streamId,
      credential_id: config.credentialId!,
      form_id: config.formId!,
      api_url: config.apiUrl || DEFAULT_GCFORMS_API_URL,
      identity_provider_url: config.identityProviderUrl || DEFAULT_GCFORMS_IDP_URL,
      project_identifier: config.projectIdentifier || DEFAULT_GCFORMS_PROJECT_IDENTIFIER,
      contact_email: config.contactEmail || null,
      preferred_language: config.preferredLanguage,
      status: 'active'
    })
    .returningAll()
    .executeTakeFirstOrThrow() as ConnectionRow
}

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
    config: config as never,
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
          config: config as never
        })
        .returningAll()
        .executeTakeFirstOrThrow()

  await db
    .updateTable('extensions.gcs_gcforms_field_mappings')
    .set({ _deleted: true })
    .where('integration_id', '=', String(integration.id))
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
        default_value: jsonbValue(mapping.defaultValue) as never,
        on_missing: mapping.onMissing,
        on_invalid: mapping.onInvalid
      })))
      .execute()
  }

  return integration as IntegrationRow
}

export const createConfiguredClient = async (
  rawDb: unknown,
  streamId: string,
  config: GcsGcFormsStreamConfig
): Promise<GcFormsApiClient> => {
  const streamContext = await resolveExtensionStreamContext(rawDb as never, streamId)
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

  const credential = await getGcFormsCredential(rawDb, streamContext.agencyId, config.credentialId!)
  return new GcFormsApiClient({
    apiUrl: config.apiUrl,
    identityProviderUrl: config.identityProviderUrl,
    projectIdentifier: config.projectIdentifier,
    privateApiKey: {
      ...credential,
      formId: config.formId || credential.formId
    }
  })
}

export const refreshTemplate = async (
  rawDb: unknown,
  streamId: string
) => {
  const db = asGcFormsIntegrationDb(rawDb)
  const config = await getStreamConfig(rawDb as HostDb, streamId)
  const connection = await ensureConnection(rawDb, streamId, config)
  await ensureIntegration(rawDb, streamId, String(connection.id), config)
  const client = await createConfiguredClient(rawDb, streamId, config)
  const template = await client.getFormTemplate()
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
        template: template as never,
        field_catalog: fieldCatalog as never,
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
        template: template as never,
        field_catalog: fieldCatalog as never
      })
      .execute()
  }

  await db
    .updateTable('extensions.gcs_gcforms_connections')
    .set({ last_template_refresh_at: new Date(), updated_at: new Date() })
    .where('id', '=', String(connection.id))
    .execute()

  return {
    connection,
    template,
    fieldCatalog
  }
}

const assertGcFormsTemplateShapeUnchanged = async (
  db: GcFormsIntegrationDb,
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

export const syncStream = async (
  rawDb: unknown,
  streamId: string
) => {
  const db = asGcFormsIntegrationDb(rawDb)
  const config = await getStreamConfig(rawDb as HostDb, streamId)
  const connection = await ensureConnection(rawDb, streamId, config)
  const client = await createConfiguredClient(rawDb, streamId, config)
  const currentTemplate = await client.getFormTemplate()
  await assertGcFormsTemplateShapeUnchanged(db, String(connection.id), currentTemplate)
  const integration = await ensureIntegration(rawDb, streamId, String(connection.id), config)

  const run = await db
    .insertInto('extensions.gcs_gcforms_import_runs')
    .values({
      connection_id: String(connection.id),
      integration_id: String(integration.id),
      status: 'running',
      discovered_count: 0,
      imported_count: 0,
      problem_count: 0
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  let importedCount = 0
  let problemCount = 0
  const submissions = await client.getNewSubmissions()

  try {
    for (const submission of submissions) {
      const existing = await db
        .selectFrom('extensions.gcs_gcforms_submissions')
        .selectAll()
        .where('connection_id', '=', String(connection.id))
        .where('submission_name', '=', submission.name)
        .where('_deleted', '=', false)
        .executeTakeFirst()

      const row = existing
        ? existing
        : await db
            .insertInto('extensions.gcs_gcforms_submissions')
            .values({
              connection_id: String(connection.id),
              integration_id: String(integration.id),
              form_id: connection.form_id,
              submission_name: submission.name,
              gcforms_created_at: new Date(submission.createdAt),
              status: 'discovered'
            })
            .returningAll()
            .executeTakeFirstOrThrow()

      try {
        const decrypted = await client.getDecryptedSubmission(submission.name)
        if (!verifyGcFormsIntegrity(decrypted.answers, decrypted.checksum)) {
          throw new Error('GC Forms checksum verification failed')
        }

        const answers = normalizeGcFormsAnswers(decrypted.answers, currentTemplate)
        answers.__gcforms_created_at = new Date(decrypted.createdAt).toISOString()
        const preview = previewGcFormsMapping(answers, config.mappings)
        const materialization = preview.issues.length === 0
          ? await materializeGcFormsClaimSubmission(rawDb, {
              streamId,
              integrationId: String(integration.id),
              submissionId: String(row.id),
              mappings: config.mappings,
              mappedValues: preview.values
            })
          : {
              status: 'failed' as const,
              lineItemIds: [],
              issues: []
            }
        const issues = [...preview.issues, ...materialization.issues]
        const status = preview.issues.length > 0
          ? 'mapping_failed'
          : materialization.status === 'failed'
            ? 'materialization_failed'
            : materialization.status === 'created' || materialization.status === 'already_materialized'
              ? 'imported'
              : 'mapped'

        await db
          .updateTable('extensions.gcs_gcforms_submissions')
          .set({
            integration_id: String(integration.id),
            status,
            confirmation_code: decrypted.confirmationCode,
            answers: answers as never,
            answers_checksum: decrypted.checksum,
            mapped_values: preview.values as never,
            mapping_issues: issues as never,
            last_error: issues[0]?.message ?? null,
            updated_at: new Date()
          })
          .where('id', '=', String(row.id))
          .execute()

        await db
          .updateTable('extensions.gcs_gcforms_attachments')
          .set({ _deleted: true })
          .where('submission_id', '=', String(row.id))
          .where('_deleted', '=', false)
          .execute()

        if (decrypted.attachments?.length) {
          await db
            .insertInto('extensions.gcs_gcforms_attachments')
            .values(decrypted.attachments.map(attachment => ({
              submission_id: String(row.id),
              gcforms_attachment_id: attachment.id ?? null,
              file_name: attachment.name,
              source_url: attachment.downloadLink,
              storage_path: null,
              md5: attachment.md5 ?? null,
              is_potentially_malicious: attachment.isPotentiallyMalicious
            })))
            .execute()
        }

        if (issues.length > 0) {
          problemCount += 1
        } else {
          if (config.confirmSubmissions) {
            await client.confirmSubmission(submission.name, decrypted.confirmationCode)
          }
          importedCount += 1
        }
      } catch (error: unknown) {
        problemCount += 1
        await db
          .updateTable('extensions.gcs_gcforms_submissions')
          .set({
            status: 'problem',
            last_error: error instanceof Error ? error.message : String(error),
            updated_at: new Date()
          })
          .where('id', '=', String(row.id))
          .execute()
      }
    }

    await db
      .updateTable('extensions.gcs_gcforms_import_runs')
      .set({
        status: 'completed',
        finished_at: new Date(),
        discovered_count: submissions.length,
        imported_count: importedCount,
        problem_count: problemCount
      })
      .where('id', '=', String(run.id))
      .execute()
  } catch (error: unknown) {
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
      .where('id', '=', String(run.id))
      .execute()
    throw error
  }

  return {
    runId: String(run.id),
    discovered: submissions.length,
    imported: importedCount,
    problems: problemCount
  }
}
