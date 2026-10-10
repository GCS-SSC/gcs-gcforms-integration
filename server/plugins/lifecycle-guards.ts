import { sql, type Transaction } from 'kysely'
import { ZodError } from 'zod'
import {
  createGcsExtensionUserError,
  defineGcsExtensionNitroPlugin,
  lockGcsExtensionLifecycleScope,
  registerGcsExtensionConfigurationGuard,
  registerGcsExtensionDisableGuard,
  registerGcsExtensionStatusReferenceGuard,
  type GcsExtensionConfigurationGuardContext,
  type GcsExtensionStatusReferenceGuardContext,
  type GcsExtensionDisableGuardContext
} from '@gcs-ssc/extensions/server'
import { GCFORMS_EXTENSION_KEY } from '../../shared/gcforms.ts'
import { parseGcFormsAgencyConfig } from '../../shared/gcforms.ts'
import { asGcFormsIntegrationDb } from '../db.ts'

/** Reports whether this installed integration has migrated its submission storage. */
const hasSubmissionStorage = async (db: ReturnType<typeof asGcFormsIntegrationDb>): Promise<boolean> => {
  const storage = await sql<{ submissions: string | null }>`SELECT to_regclass('extensions.gcs_gcforms_submissions')::text AS submissions`.execute(db)
  return Boolean(storage.rows[0]?.submissions)
}

/** Blocks scope disablement or deletion while GC Forms confirmations remain recoverable. */
export const guardGcFormsLifecycleChange = async (
  context: GcsExtensionDisableGuardContext
): Promise<void> => {
  await lockGcsExtensionLifecycleScope(
    context.db as Transaction<unknown>,
    GCFORMS_EXTENSION_KEY,
    context.agencyId,
    context.scope === 'stream' ? context.streamId : undefined
  )

  const db = asGcFormsIntegrationDb(context.db)
  if (context.scope === 'stream' && !context.streamId) {
    throw new Error('GC Forms stream lifecycle guards require a stream id.')
  }
  if (!await hasSubmissionStorage(db)) return
  let query = db
    .selectFrom('extensions.gcs_gcforms_submissions as submission')
    .innerJoin(
      'extensions.gcs_gcforms_connections as connection',
      'connection.id',
      'submission.connection_id'
    )
    .select('submission.id')
    .where('connection.agency_id', '=', context.agencyId)
    .where('submission.status', 'in', ['imported_pending_confirm', 'materialization_failed'])
    .where('submission._deleted', '=', false)

  if (context.scope === 'stream') {
    query = query.where('connection.stream_id', '=', context.streamId!)
  }

  const recoverableSubmission = await query.executeTakeFirst()
  if (recoverableSubmission) {
    throw createGcsExtensionUserError({
      statusCode: 409,
      code: 'GCS_GCFORMS_SCOPE_RECOVERABLE_SUBMISSIONS',
      message: {
        en: 'GC Forms cannot be disabled or deleted for this scope until all recoverable submissions are resolved.',
        fr: 'Formulaires GC ne peut pas être désactivé ni supprimé pour cette portée tant que toutes les soumissions récupérables ne sont pas réglées.'
      }
    })
  }
}

const createGcFormsSubmissionStatusRequiredError = () => createGcsExtensionUserError({
  statusCode: 400,
  code: 'GCS_GCFORMS_SUBMISSION_STATUS_REQUIRED',
  message: {
    en: 'Select an Agency status for claims imported from GC Forms before enabling the integration.',
    fr: 'Sélectionnez un statut d’organisme pour les demandes de remboursement importées de Formulaires GC avant d’activer l’intégration.'
  }
})

const createGcFormsSubmissionStatusUnavailableError = () => createGcsExtensionUserError({
  statusCode: 400,
  code: 'GCS_GCFORMS_SUBMISSION_STATUS_UNAVAILABLE',
  message: {
    en: 'The selected imported claim status is not active for this agency.',
    fr: 'Le statut sélectionné pour les demandes de remboursement importées n’est pas actif pour cet organisme.'
  }
})

const createGcFormsSubmissionStatusNotDraftError = () => createGcsExtensionUserError({
  statusCode: 400,
  code: 'GCS_GCFORMS_SUBMISSION_STATUS_NOT_DRAFT',
  message: {
    en: 'Claims imported from GC Forms must use the agency Draft status.',
    fr: 'Les demandes de remboursement importées de Formulaires GC doivent utiliser le statut d’ébauche de l’organisme.'
  }
})

const createGcFormsSubmissionStatusInvalidError = () => createGcsExtensionUserError({
  statusCode: 400,
  code: 'GCS_GCFORMS_SUBMISSION_STATUS_INVALID',
  message: {
    en: 'The selected imported claim status identifier is invalid.',
    fr: 'L’identifiant du statut sélectionné pour les demandes de remboursement importées est invalide.'
  }
})

const createGcFormsSubmissionStatusReferencedError = () => createGcsExtensionUserError({
  statusCode: 409,
  code: 'GCS_GCFORMS_SUBMISSION_STATUS_REFERENCED',
  message: {
    en: 'This status is still required by recoverable GC Forms imported claims.',
    fr: 'Ce statut est toujours requis par des demandes de remboursement importées récupérables de Formulaires GC.'
  }
})

const findRecoverableHistoricalStatusReference = async (
  db: ReturnType<typeof asGcFormsIntegrationDb>,
  agencyId: string,
  statusId?: string,
  match: 'equal' | 'different' = 'equal'
) => {
  if (!await hasSubmissionStorage(db)) return undefined

  let query = db
    .selectFrom('extensions.gcs_gcforms_submissions as submission')
    .innerJoin('extensions.gcs_gcforms_connections as connection', 'connection.id', 'submission.connection_id')
    .innerJoin('extensions.gcs_gcforms_integrations as integration', 'integration.id', 'submission.integration_id')
    .select('submission.id')
    .where('connection.agency_id', '=', agencyId)
    .where('submission.status', '=', 'materialization_failed')
    .where('submission._deleted', '=', false)
    .where('integration._deleted', '=', false)
  if (statusId !== undefined) {
    query = match === 'equal'
      ? query.where(sql<boolean>`integration.config ->> 'submissionStatusId' = ${statusId}`)
      : query.where(sql<boolean>`integration.config ->> 'submissionStatusId' IS DISTINCT FROM ${statusId}`)
  }
  return await query.executeTakeFirst()
}

/** Validates and locks the configured live Agency status before host configuration persistence. */
export const guardGcFormsConfiguration = async (
  context: GcsExtensionConfigurationGuardContext
): Promise<void> => {
  if (
    context.extensionKey !== context.targetExtensionKey
    || context.scope !== 'agency'
    || !context.enabled
  ) {
    return
  }

  const db = asGcFormsIntegrationDb(context.db)
  const persisted = context.config === undefined
    ? await db
        .selectFrom('extensions.agency_enablement')
        .select('config')
        .where('extension_key', '=', GCFORMS_EXTENSION_KEY)
        .where('agency_id', '=', context.agencyId)
        .where('_deleted', '=', false)
        .executeTakeFirst()
    : undefined
  let config
  try {
    config = parseGcFormsAgencyConfig(context.config ?? persisted?.config ?? {})
  } catch (error: unknown) {
    if (error instanceof ZodError) throw createGcFormsSubmissionStatusInvalidError()
    throw error
  }
  if (!config.submissionStatusId) {
    throw createGcFormsSubmissionStatusRequiredError()
  }

  const status = await db
    .selectFrom('Common_Status')
    .select(['id', 'egcs_cn_isdraft'])
    .where('id', '=', sql<string>`${config.submissionStatusId}::bigint`)
    .where('egcs_cn_agency', '=', sql<string>`${context.agencyId}::bigint`)
    .where('_deleted', '=', false)
    .forUpdate()
    .executeTakeFirst()
  if (!status) {
    throw createGcFormsSubmissionStatusUnavailableError()
  }
  if (!status.egcs_cn_isdraft) {
    throw createGcFormsSubmissionStatusNotDraftError()
  }
  if (!await hasSubmissionStorage(db)) return
  const legacyIntegrations = await db
    .selectFrom('extensions.gcs_gcforms_submissions as submission')
    .innerJoin('extensions.gcs_gcforms_connections as connection', 'connection.id', 'submission.connection_id')
    .innerJoin('extensions.gcs_gcforms_integrations as integration', 'integration.id', 'submission.integration_id')
    .select('integration.id')
    .distinct()
    .where('connection.agency_id', '=', context.agencyId)
    .where('submission.status', '=', 'materialization_failed')
    .where('submission._deleted', '=', false)
    .where('integration._deleted', '=', false)
    .where(sql<boolean>`integration.config ->> 'submissionStatusId' IS NULL`)
    .execute()
  if (legacyIntegrations.length > 0) {
    await db.updateTable('extensions.gcs_gcforms_integrations')
      .set({
        config: sql`jsonb_set(config, '{submissionStatusId}', to_jsonb(${config.submissionStatusId}::text), true)`
      })
      .where('id', 'in', legacyIntegrations.map(integration => String(integration.id)))
      .execute()
  }
  const historicalReference = await findRecoverableHistoricalStatusReference(
    db, context.agencyId, config.submissionStatusId, 'different'
  )
  if (historicalReference) throw createGcFormsSubmissionStatusReferencedError()
}

/** Rejects Agency status deletion while the live GC Forms Agency configuration references it. */
export const guardGcFormsStatusReference = async (
  context: GcsExtensionStatusReferenceGuardContext
): Promise<void> => {
  const db = asGcFormsIntegrationDb(context.db)
  const reference = await db
    .selectFrom('extensions.agency_enablement')
    .select('id')
    .where('extension_key', '=', GCFORMS_EXTENSION_KEY)
    .where('agency_id', '=', context.agencyId)
    .where('_deleted', '=', false)
    .where(sql<boolean>`config ->> 'submissionStatusId' = ${context.statusId}`)
    .forUpdate()
    .executeTakeFirst()
  const historicalReference = await findRecoverableHistoricalStatusReference(db, context.agencyId, context.statusId)
  if (reference || historicalReference) throw createGcFormsSubmissionStatusReferencedError()
}

export default defineGcsExtensionNitroPlugin(nitroApp => {
  registerGcsExtensionDisableGuard(
    GCFORMS_EXTENSION_KEY,
    guardGcFormsLifecycleChange,
    nitroApp
  )
  registerGcsExtensionConfigurationGuard(
    GCFORMS_EXTENSION_KEY,
    guardGcFormsConfiguration,
    nitroApp
  )
  registerGcsExtensionStatusReferenceGuard(
    GCFORMS_EXTENSION_KEY,
    guardGcFormsStatusReference,
    nitroApp
  )
})
