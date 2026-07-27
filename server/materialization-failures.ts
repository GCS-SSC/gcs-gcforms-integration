import { z } from 'zod'
import { createGcsExtensionUserError, type GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import type { JsonValue } from '@gcs-ssc/extensions'
import {
  type GcsDestinationEntity,
  type GcsGcFormsMappedValue,
  type GcsGcFormsMappingIssue,
  type GcsGcFormsStreamConfig,
  parseGcFormsStreamConfig
} from '../shared/gcforms.ts'
import { asGcFormsIntegrationDb, type GcFormsIntegrationDb } from './db.ts'
import { gcFormsJsonbValue } from './jsonb.ts'
import { CLAIM_AGREEMENT_DESTINATION_PATH, CLAIM_AGREEMENT_NUMBER_PATH, materializeGcFormsClaimSubmission } from './materialize-claims.ts'
import { reconcileGcFormsSubmissionConfirmation, runAuthorizedGcFormsWrite } from './runtime.ts'
import { shouldConfirmGcFormsSubmission } from './submission-confirmation.ts'

type ClaimMaterializationStatus = 'not_applicable' | 'created' | 'already_materialized' | 'failed'

interface GcFormsMaterializationFailureItem {
  submissionId: string
  submissionName: string
  agreementNumber: string | null
  selectedAgreementId: string | null
  lastError: string | null
  issues: GcsGcFormsMappingIssue[]
  createdAt: string
}

export const ResolveClaimMaterializationFailureSchema = z.object({
  agreementId: z.union([z.string(), z.number()]).transform(value => String(value)).pipe(z.string().min(1))
})

const AGREEMENT_OWNER_TYPE = 'fundingcaseagreement'
const CLAIM_ENTITY: GcsDestinationEntity = 'claim'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isMappingIssue = (value: unknown): value is GcsGcFormsMappingIssue => {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.mappingId === 'string'
    && typeof value.sourceQuestionId === 'string'
    && typeof value.destinationPath === 'string'
    && typeof value.code === 'string'
    && typeof value.message === 'string'
}

const mappingIssues = (value: JsonValue | null): GcsGcFormsMappingIssue[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const issues: GcsGcFormsMappingIssue[] = []
  for (const item of value) {
    if (isMappingIssue(item)) {
      issues.push(item)
    }
  }

  return issues
}

const isMappedValue = (value: unknown): value is GcsGcFormsMappedValue => {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.mappingId === 'string'
    && typeof value.sourceQuestionId === 'string'
    && typeof value.destinationEntity === 'string'
    && typeof value.destinationPath === 'string'
}

const mappedValues = (value: JsonValue | null): GcsGcFormsMappedValue[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const values: GcsGcFormsMappedValue[] = []
  for (const item of value) {
    if (isMappedValue(item)) {
      values.push(item)
    }
  }

  return values
}

const mappedAgreementNumber = (values: GcsGcFormsMappedValue[]): string | null => {
  const mapped = values.find(value =>
    value.destinationEntity === CLAIM_ENTITY
    && (value.destinationPath === CLAIM_AGREEMENT_NUMBER_PATH || value.destinationPath === CLAIM_AGREEMENT_DESTINATION_PATH)
  )

  return typeof mapped?.value === 'string' && mapped.value.trim() ? mapped.value.trim() : null
}

const materializationStatus = (status: ClaimMaterializationStatus): 'mapped' | 'materialization_failed' | 'imported' =>
  status === 'failed'
    ? 'materialization_failed'
    : status === 'not_applicable'
      ? 'mapped'
      : 'imported'

/** Loads active manual agreement selections keyed by submission identifier. */
const selectedAgreementOverrides = async (
  rawDb: unknown,
  submissionIds: string[]
): Promise<Map<string, string>> => {
  if (submissionIds.length === 0) {
    return new Map()
  }

  const db = asGcFormsIntegrationDb(rawDb)
  const rows = await db
    .selectFrom('extensions.gcs_gcforms_materialization_overrides')
    .select(['submission_id', 'owner_id'])
    .where('destination_entity', '=', CLAIM_ENTITY)
    .where('destination_path', '=', CLAIM_AGREEMENT_NUMBER_PATH)
    .where('owner_type', '=', AGREEMENT_OWNER_TYPE)
    .where('submission_id', 'in', submissionIds)
    .where('_deleted', '=', false)
    .execute()

  return new Map(rows.map(row => [String(row.submission_id), String(row.owner_id)]))
}

/** Lists failed claim materializations together with mapping issues and agreement matching choices. */
export const listClaimMaterializationFailures = async (
  context: GcsExtensionRouteContext,
  streamId: string
) => {
  const rawDb = context.db
  const db = asGcFormsIntegrationDb(rawDb)
  const rows = await db
    .selectFrom('extensions.gcs_gcforms_submissions as submission')
    .innerJoin(
      'extensions.gcs_gcforms_connections as connection',
      'connection.id',
      'submission.connection_id'
    )
    .select([
      'submission.id as id',
      'submission.submission_name as submission_name',
      'submission.mapped_values as mapped_values',
      'submission.mapping_issues as mapping_issues',
      'submission.last_error as last_error',
      'submission.created_at as created_at'
    ])
    .where('connection.stream_id', '=', streamId)
    .where('submission.status', '=', 'materialization_failed')
    .where('submission._deleted', '=', false)
    .orderBy('submission.updated_at', 'desc')
    .execute()

  const failedRows = rows
    .map(row => ({
      row,
      issues: mappingIssues(row.mapping_issues),
      values: mappedValues(row.mapped_values)
    }))

  const overrides = await selectedAgreementOverrides(rawDb, failedRows.map(item => String(item.row.id)))
  if (!context.agreementAccess) {
    throw new Error('GC Forms agreement options require host-provided agreement visibility.')
  }
  const agreements = await context.agreementAccess.listVisibleOptions(rawDb, {
    streamId,
    action: 'read'
  })
  const visibleAgreementIds = new Set(agreements.map(agreement => agreement.id))
  const items: GcFormsMaterializationFailureItem[] = failedRows.map(item => {
    const submissionId = String(item.row.id)
    const createdAt = item.row.created_at instanceof Date
      ? item.row.created_at.toISOString()
      : String(item.row.created_at)

    return {
      submissionId,
      submissionName: item.row.submission_name,
      agreementNumber: mappedAgreementNumber(item.values),
      selectedAgreementId: visibleAgreementIds.has(overrides.get(submissionId) ?? '')
        ? overrides.get(submissionId) ?? null
        : null,
      lastError: item.row.last_error,
      issues: item.issues,
      createdAt
    }
  })

  return {
    items,
    agreements,
    total: items.length
  }
}

const createSubmissionNotFoundError = () => createGcsExtensionUserError({
  statusCode: 404,
  code: 'GCS_GCFORMS_SUBMISSION_NOT_FOUND',
  message: {
    en: 'GC Forms submission was not found for this stream.',
    fr: 'La soumission GC Forms est introuvable pour ce volet.'
  }
})

const createSubmissionStatusConflictError = () => createGcsExtensionUserError({
  statusCode: 409,
  code: 'GCS_GCFORMS_SUBMISSION_NOT_MATERIALIZATION_FAILED',
  message: {
    en: 'This GC Forms submission is no longer awaiting materialization failure resolution.',
    fr: 'Cette soumission GC Forms n attend plus la resolution d un echec de materialisation.'
  }
})

const createMaterializationContextConflictError = () => createGcsExtensionUserError({
  statusCode: 409,
  code: 'GCS_GCFORMS_MATERIALIZATION_CONTEXT_MISSING',
  message: {
    en: 'The saved GC Forms materialization context is no longer available.',
    fr: 'Le contexte de materialisation GC Forms enregistre n est plus disponible.'
  }
})

const createAgreementOverrideInvalidError = () => createGcsExtensionUserError({
  statusCode: 400,
  code: 'GCS_GCFORMS_AGREEMENT_OVERRIDE_INVALID',
  message: {
    en: 'Selected agreement is not available in this transfer payment stream.',
    fr: 'L entente selectionnee n est pas disponible dans ce volet de paiements de transfert.'
  }
})

/** Creates or updates the manual agreement override for a failed claim submission. */
const saveAgreementOverride = async (
  rawDb: unknown,
  submissionId: string,
  agreementId: string
) => {
  const db = asGcFormsIntegrationDb(rawDb)
  const existing = await db
    .selectFrom('extensions.gcs_gcforms_materialization_overrides')
    .select('id')
    .where('submission_id', '=', submissionId)
    .where('destination_entity', '=', CLAIM_ENTITY)
    .where('destination_path', '=', CLAIM_AGREEMENT_NUMBER_PATH)
    .where('owner_type', '=', AGREEMENT_OWNER_TYPE)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  if (existing) {
    await db
      .updateTable('extensions.gcs_gcforms_materialization_overrides')
      .set({
        owner_id: agreementId,
        updated_at: new Date()
      })
      .where('id', '=', String(existing.id))
      .execute()
    return
  }

  await db
    .insertInto('extensions.gcs_gcforms_materialization_overrides')
    .values({
      submission_id: submissionId,
      destination_entity: CLAIM_ENTITY,
      destination_path: CLAIM_AGREEMENT_NUMBER_PATH,
      owner_type: AGREEMENT_OWNER_TYPE,
      owner_id: agreementId
    })
    .execute()
}

/** Applies a manual agreement match, retries claim materialization, and persists the resulting status. */
export const resolveClaimMaterializationFailure = async (
  context: GcsExtensionRouteContext,
  streamId: string,
  submissionId: string,
  agreementId: string
) => {
  const resolution = await runAuthorizedGcFormsWrite(context, async trx => {
  const lockAndAuthorizeAgreement = context.writeAuthorization?.lockAndAuthorizeAgreement
  if (!lockAndAuthorizeAgreement) {
    throw new Error('GC Forms recovery requires host-provided agreement write authorization.')
  }
  const agreementAvailable = await lockAndAuthorizeAgreement(trx, {
    agreementId,
    streamId,
    action: 'update'
  })
  if (!agreementAvailable) {
    throw createAgreementOverrideInvalidError()
  }
  const submission = await trx
    .selectFrom('extensions.gcs_gcforms_submissions as submission')
    .innerJoin(
      'extensions.gcs_gcforms_connections as connection',
      'connection.id',
      'submission.connection_id'
    )
    .selectAll('submission')
    .where('submission.id', '=', submissionId)
    .where('connection.stream_id', '=', streamId)
    .where('submission._deleted', '=', false)
    .forUpdate('submission')
    .executeTakeFirst()
  if (!submission) {
    throw createSubmissionNotFoundError()
  }
  if (submission.status !== 'materialization_failed') {
    throw createSubmissionStatusConflictError()
  }

  const integrationId = submission.integration_id === null
    ? null
    : String(submission.integration_id)
  const integration = integrationId === null
    ? undefined
    : await trx
        .selectFrom('extensions.gcs_gcforms_integrations')
        .select(['id', 'config'])
        .where('id', '=', integrationId)
        .where('connection_id', '=', String(submission.connection_id))
        .where('stream_id', '=', streamId)
        .where('_deleted', '=', false)
        .executeTakeFirst()
  if (!integration) {
    throw createMaterializationContextConflictError()
  }

  await saveAgreementOverride(trx, submissionId, agreementId)

  const streamConfig: GcsGcFormsStreamConfig = parseGcFormsStreamConfig(integration.config)
  const result = await materializeGcFormsClaimSubmission(trx, {
    streamId,
    integrationId: String(integration.id),
    submissionId,
    submissionUuid: submission.submission_name,
    mappings: streamConfig.mappings,
    mappedValues: mappedValues(submission.mapped_values),
    authorizeAgreementUpdate: async resolvedAgreementId => {
      if (resolvedAgreementId !== agreementId) {
        throw createAgreementOverrideInvalidError()
      }
    }
  })
  const shouldConfirm = shouldConfirmGcFormsSubmission(
    streamConfig.confirmSubmissions,
    result.status,
    result.issues
  )
  const status = shouldConfirm
    ? 'imported_pending_confirm' as const
    : materializationStatus(result.status)

  const updated = await trx
    .updateTable('extensions.gcs_gcforms_submissions')
    .set({
      integration_id: String(integration.id),
      status,
      mapping_issues: gcFormsJsonbValue(result.issues),
      last_error: result.issues[0]?.message ?? null,
      updated_at: new Date()
    })
    .where('id', '=', submissionId)
    .where('status', '=', 'materialization_failed')
    .where('_deleted', '=', false)
    .returning('id')
    .executeTakeFirst()
  if (!updated) {
    throw createSubmissionStatusConflictError()
  }

  return {
    shouldConfirm,
    response: {
      ok: result.status !== 'failed',
      status,
      materialization: result
    }
  }
  }, streamId)

  if (!resolution.shouldConfirm) {
    return resolution.response
  }

  await reconcileGcFormsSubmissionConfirmation(context, streamId, {
    submissionId,
    remotelyPending: true
  })
  return {
    ...resolution.response,
    status: 'imported' as const
  }
}
