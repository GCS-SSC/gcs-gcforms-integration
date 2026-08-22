import { sql, type Transaction } from 'kysely'
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
    if (!context.streamId) {
      throw new Error('GC Forms stream lifecycle guards require a stream id.')
    }
    query = query.where('connection.stream_id', '=', context.streamId)
  }

  const recoverableSubmission = await query.executeTakeFirst()
  if (recoverableSubmission) {
    throw createGcsExtensionUserError({
      statusCode: 409,
      code: 'GCS_GCFORMS_SCOPE_RECOVERABLE_SUBMISSIONS',
      message: {
        en: 'GC Forms cannot be disabled or deleted for this scope until all recoverable submissions are resolved.',
        fr: 'GC Forms ne peut pas etre desactive ni supprime pour cette portee tant que toutes les soumissions recuperables ne sont pas reglees.'
      }
    })
  }
}

const createGcFormsSubmissionStatusRequiredError = () => createGcsExtensionUserError({
  statusCode: 400,
  code: 'GCS_GCFORMS_SUBMISSION_STATUS_REQUIRED',
  message: {
    en: 'Select an Agency status for claims imported from GC Forms before enabling the integration.',
    fr: 'Selectionnez un statut d organisation pour les reclamations importees de GC Forms avant d activer l integration.'
  }
})

const createGcFormsSubmissionStatusUnavailableError = () => createGcsExtensionUserError({
  statusCode: 400,
  code: 'GCS_GCFORMS_SUBMISSION_STATUS_UNAVAILABLE',
  message: {
    en: 'The selected imported claim status is not active for this agency.',
    fr: 'Le statut selectionne pour les reclamations importees n est pas actif pour cette organisation.'
  }
})

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
  const config = parseGcFormsAgencyConfig(context.config ?? persisted?.config ?? {})
  if (!config.submissionStatusId) {
    throw createGcFormsSubmissionStatusRequiredError()
  }

  const status = await db
    .selectFrom('Common_Status')
    .select('id')
    .where('id', '=', sql<string>`${config.submissionStatusId}::bigint`)
    .where('egcs_cn_agency', '=', sql<string>`${context.agencyId}::bigint`)
    .where('_deleted', '=', false)
    .forUpdate()
    .executeTakeFirst()
  if (!status) {
    throw createGcFormsSubmissionStatusUnavailableError()
  }
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
  if (reference) {
    throw createGcsExtensionUserError({
      statusCode: 409,
      code: 'GCS_GCFORMS_SUBMISSION_STATUS_REFERENCED',
      message: {
        en: 'This status is still configured for GC Forms imported claims.',
        fr: 'Ce statut est toujours configure pour les reclamations importees de GC Forms.'
      }
    })
  }
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
