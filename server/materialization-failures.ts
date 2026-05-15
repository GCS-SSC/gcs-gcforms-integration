/* eslint-disable jsdoc/require-jsdoc */
import { z } from 'zod'
import { createGcsExtensionUserError } from '@gcs-ssc/extensions/server'
import type { JsonValue } from '@gcs-ssc/extensions'
import {
  type GcsDestinationEntity,
  type GcsGcFormsMappedValue,
  type GcsGcFormsMappingIssue,
  type GcsGcFormsStreamConfig,
  parseGcFormsStreamConfig
} from '../shared/gcforms'
import { asGcFormsIntegrationDb, type GcFormsIntegrationDb } from './db'
import { CLAIM_AGREEMENT_DESTINATION_PATH, CLAIM_AGREEMENT_NUMBER_PATH, materializeGcFormsClaimSubmission } from './materialize-claims'
import { ensureConnection, ensureIntegration, getStreamConfig } from './runtime'

type HostDb = GcFormsIntegrationDb & {
  selectFrom: (table: string) => unknown
  insertInto: (table: string) => unknown
  updateTable: (table: string) => unknown
}

type SubmissionFailureRow = {
  id: string
  submission_name: string
  mapped_values: JsonValue | null
  mapping_issues: JsonValue | null
  last_error: string | null
  created_at: Date | string
}

type ClaimMaterializationStatus = 'not_applicable' | 'created' | 'already_materialized' | 'failed'

export interface GcFormsAgreementOption {
  id: string
  agreementNumber: string
  label: string
}

export interface GcFormsMaterializationFailureItem {
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

const hasAgreementResolutionIssue = (issues: GcsGcFormsMappingIssue[]): boolean =>
  issues.some(issue =>
    issue.destinationPath === CLAIM_AGREEMENT_DESTINATION_PATH
    && (issue.code === 'agreement_not_found' || issue.message.includes('Agreement number could not be resolved'))
  )

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

const streamAgreements = async (
  rawDb: unknown,
  streamId: string
): Promise<GcFormsAgreementOption[]> => {
  const db = asGcFormsIntegrationDb(rawDb)
  const agreements = await db
    .selectFrom('Funding_Case_Agreement_Profile')
    .select(['id', 'egcs_fc_agreementnumber'])
    .where('egcs_fc_transferpaymentstream', '=', streamId)
    .where('_deleted', '=', false)
    .orderBy('egcs_fc_agreementnumber', 'asc')
    .execute()

  return agreements.map(agreement => {
    const agreementNumber = String(agreement.egcs_fc_agreementnumber)
    return {
      id: String(agreement.id),
      agreementNumber,
      label: agreementNumber
    }
  })
}

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

const ensureFailureContext = async (
  rawDb: unknown,
  streamId: string
): Promise<{ config: GcsGcFormsStreamConfig; connectionId: string; integrationId: string }> => {
  const config = await getStreamConfig(rawDb as HostDb, streamId)
  const connection = await ensureConnection(rawDb, streamId, config)
  const integration = await ensureIntegration(rawDb, streamId, String(connection.id), config)

  return {
    config,
    connectionId: String(connection.id),
    integrationId: String(integration.id)
  }
}

export const listClaimMaterializationFailures = async (
  rawDb: unknown,
  streamId: string
) => {
  const db = asGcFormsIntegrationDb(rawDb)
  const { connectionId } = await ensureFailureContext(rawDb, streamId)
  const rows = await db
    .selectFrom('extensions.gcs_gcforms_submissions')
    .select(['id', 'submission_name', 'mapped_values', 'mapping_issues', 'last_error', 'created_at'])
    .where('connection_id', '=', connectionId)
    .where('status', '=', 'materialization_failed')
    .where('_deleted', '=', false)
    .orderBy('updated_at', 'desc')
    .execute() as SubmissionFailureRow[]

  const unresolvedRows = rows
    .map(row => ({
      row,
      issues: mappingIssues(row.mapping_issues),
      values: mappedValues(row.mapped_values)
    }))
    .filter(item => hasAgreementResolutionIssue(item.issues))

  const overrides = await selectedAgreementOverrides(rawDb, unresolvedRows.map(item => String(item.row.id)))
  const agreements = await streamAgreements(rawDb, streamId)
  const items: GcFormsMaterializationFailureItem[] = unresolvedRows.map(item => {
    const submissionId = String(item.row.id)
    const createdAt = item.row.created_at instanceof Date
      ? item.row.created_at.toISOString()
      : String(item.row.created_at)

    return {
      submissionId,
      submissionName: item.row.submission_name,
      agreementNumber: mappedAgreementNumber(item.values),
      selectedAgreementId: overrides.get(submissionId) ?? null,
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

const assertAgreementInStream = async (
  rawDb: unknown,
  streamId: string,
  agreementId: string
) => {
  const db = asGcFormsIntegrationDb(rawDb)
  const agreement = await db
    .selectFrom('Funding_Case_Agreement_Profile')
    .select('id')
    .where('id', '=', agreementId)
    .where('egcs_fc_transferpaymentstream', '=', streamId)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  if (!agreement) {
    throw createGcsExtensionUserError({
      statusCode: 400,
      code: 'GCS_GCFORMS_AGREEMENT_OVERRIDE_INVALID',
      message: {
        en: 'Selected agreement is not available in this transfer payment stream.',
        fr: 'L entente selectionnee n est pas disponible dans ce volet de paiements de transfert.'
      }
    })
  }
}

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

export const resolveClaimMaterializationFailure = async (
  rawDb: unknown,
  streamId: string,
  submissionId: string,
  agreementId: string
) => {
  const db = asGcFormsIntegrationDb(rawDb)
  const { config, connectionId, integrationId } = await ensureFailureContext(rawDb, streamId)
  await assertAgreementInStream(rawDb, streamId, agreementId)

  const submission = await db
    .selectFrom('extensions.gcs_gcforms_submissions')
    .selectAll()
    .where('id', '=', submissionId)
    .where('connection_id', '=', connectionId)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  if (!submission) {
    throw createGcsExtensionUserError({
      statusCode: 404,
      code: 'GCS_GCFORMS_SUBMISSION_NOT_FOUND',
      message: {
        en: 'GC Forms submission was not found for this stream.',
        fr: 'La soumission GC Forms est introuvable pour ce volet.'
      }
    })
  }

  await saveAgreementOverride(rawDb, submissionId, agreementId)

  const streamConfig = parseGcFormsStreamConfig(config)
  const result = await materializeGcFormsClaimSubmission(rawDb, {
    streamId,
    integrationId,
    submissionId,
    mappings: streamConfig.mappings,
    mappedValues: mappedValues(submission.mapped_values)
  })
  const status = materializationStatus(result.status)

  await db
    .updateTable('extensions.gcs_gcforms_submissions')
    .set({
      integration_id: integrationId,
      status,
      mapping_issues: result.issues as never,
      last_error: result.issues[0]?.message ?? null,
      updated_at: new Date()
    })
    .where('id', '=', submissionId)
    .execute()

  return {
    ok: result.status !== 'failed',
    status,
    materialization: result
  }
}
