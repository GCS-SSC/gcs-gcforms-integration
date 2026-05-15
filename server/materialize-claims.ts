/* eslint-disable jsdoc/require-jsdoc */
import type { Insertable } from 'kysely'
import type { JsonValue } from '@gcs-ssc/extensions'
import type {
  GcsDestinationEntity,
  GcsGcFormsFieldMapping,
  GcsGcFormsMappedValue,
  GcsGcFormsMappingIssue
} from '../shared/gcforms'
import { asGcFormsIntegrationDb, type GcFormsIntegrationHostDatabase } from './db'

type ClaimInsert = Insertable<GcFormsIntegrationHostDatabase['Funding_Case_Agreement_Claim']>
type ClaimLineItemInsert = Insertable<GcFormsIntegrationHostDatabase['Funding_Case_Agreement_Claim_Line_Item']>

type DestinationOwnerType =
  | 'fundingcaseagreement'
  | 'applicantrecipient'
  | 'fundingcaseagreementclaim'
  | 'fundingcaseagreementclaimlineitem'
  | 'fundingcaseagreementmonitor'
  | 'gcforms_submission'

type NormalizedMappedValue = GcsGcFormsMappedValue & {
  normalizedPath: string
}

interface ClaimMaterializationInput {
  streamId: string
  integrationId: string
  submissionId: string
  mappings: GcsGcFormsFieldMapping[]
  mappedValues: GcsGcFormsMappedValue[]
}

interface PreparedClaim {
  agreementId: string
  agreementNumber: string
  agreementMappingId: string
  fiscalYearId: string
  isFinalForYear: boolean
  periodStart: number
  periodEnd: number
  receivedDate: Date
}

interface PreparedClaimLineItem {
  budgetLineItemId: string
  budgetLineItemMappingId: string
  description: string
  amount: number
  currency: string
}

export interface ClaimMaterializationResult {
  status: 'not_applicable' | 'created' | 'already_materialized' | 'failed'
  claimId?: string
  lineItemIds: string[]
  issues: GcsGcFormsMappingIssue[]
}

const CLAIM_ENTITY: GcsDestinationEntity = 'claim'
const CLAIM_LINE_ITEM_ENTITY: GcsDestinationEntity = 'claim_line_item'

const AGREEMENT_OWNER_TYPE: DestinationOwnerType = 'fundingcaseagreement'
const CLAIM_OWNER_TYPE: DestinationOwnerType = 'fundingcaseagreementclaim'
const CLAIM_LINE_ITEM_OWNER_TYPE: DestinationOwnerType = 'fundingcaseagreementclaimlineitem'

export const CLAIM_AGREEMENT_NUMBER_PATH = 'egcs_fc_fundingagreement'
export const CLAIM_AGREEMENT_DESTINATION_PATH = `${CLAIM_ENTITY}.${CLAIM_AGREEMENT_NUMBER_PATH}`
const CLAIM_REQUIRED_PATHS = [
  CLAIM_AGREEMENT_NUMBER_PATH,
  'egcs_fc_fiscalyear',
  'egcs_fc_isfinalforyear',
  'egcs_fc_periodstart',
  'egcs_fc_periodend',
  'egcs_fc_receiveddate'
] as const

const CLAIM_LINE_ITEM_REQUIRED_PATHS = [
  'egcs_fc_fundingagreementbudgetlineitem',
  'egcs_fc_description',
  'egcs_fc_amount',
  'egcs_fc_currency'
] as const

export const getGcFormsDestinationOwnerType = (entity: GcsDestinationEntity): DestinationOwnerType => {
  const ownerTypes: Record<GcsDestinationEntity, DestinationOwnerType> = {
    agreement: 'fundingcaseagreement',
    proponent: 'applicantrecipient',
    claim: CLAIM_OWNER_TYPE,
    claim_line_item: CLAIM_LINE_ITEM_OWNER_TYPE,
    monitor: 'fundingcaseagreementmonitor',
    source_record: 'gcforms_submission'
  }

  return ownerTypes[entity]
}

const normalizeDestinationPath = (entity: GcsDestinationEntity, path: string): string => {
  const trimmed = path.trim()
  const entityPrefix = `${entity}.`
  if (trimmed.toLowerCase().startsWith(entityPrefix)) {
    return trimmed.slice(entityPrefix.length)
  }

  if (entity === CLAIM_ENTITY && trimmed.toLowerCase().startsWith('funding_case_agreement_claim.')) {
    return trimmed.slice('Funding_Case_Agreement_Claim.'.length)
  }

  if (entity === CLAIM_LINE_ITEM_ENTITY && trimmed.toLowerCase().startsWith('funding_case_agreement_claim_line_item.')) {
    return trimmed.slice('Funding_Case_Agreement_Claim_Line_Item.'.length)
  }

  return trimmed
}

const normalizeMappedValues = (values: GcsGcFormsMappedValue[]): NormalizedMappedValue[] =>
  values.map(value => ({
    ...value,
    normalizedPath: normalizeDestinationPath(value.destinationEntity, value.destinationPath)
  }))

const mappingForPath = (
  mappings: GcsGcFormsFieldMapping[],
  entity: GcsDestinationEntity,
  path: string
): GcsGcFormsFieldMapping | undefined =>
  mappings.find(mapping =>
    mapping.destinationEntity === entity
    && normalizeDestinationPath(mapping.destinationEntity, mapping.destinationPath) === path
  )

const mappedValueForPath = (
  values: NormalizedMappedValue[],
  entity: GcsDestinationEntity,
  path: string
): NormalizedMappedValue | undefined =>
  values.find(value => value.destinationEntity === entity && value.normalizedPath === path)

const hasMaterializationMapping = (
  mappings: GcsGcFormsFieldMapping[],
  entity: GcsDestinationEntity
): boolean => mappings.some(mapping => mapping.destinationEntity === entity)

const hasPresentValue = (value: JsonValue | undefined): boolean => {
  if (value === undefined || value === null) {
    return false
  }

  if (typeof value === 'string') {
    return value.trim().length > 0
  }

  return true
}

const createIssue = (
  mappings: GcsGcFormsFieldMapping[],
  entity: GcsDestinationEntity,
  path: string,
  code: GcsGcFormsMappingIssue['code'],
  message: string
): GcsGcFormsMappingIssue => {
  const mapping = mappingForPath(mappings, entity, path)
  return {
    mappingId: mapping ? mapping.id : '',
    sourceQuestionId: mapping ? mapping.sourceQuestionId : '',
    destinationPath: `${entity}.${path}`,
    code,
    message
  }
}

const requiredString = (
  value: JsonValue | undefined
): string | null => {
  if (!hasPresentValue(value)) {
    return null
  }

  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return null
}

const requiredNumber = (value: JsonValue | undefined): number | null => {
  if (!hasPresentValue(value)) {
    return null
  }

  const parsed = typeof value === 'number'
    ? value
    : Number(String(value).replace(/,/g, '').trim())

  return Number.isFinite(parsed) ? parsed : null
}

const requiredInteger = (value: JsonValue | undefined): number | null => {
  const parsed = requiredNumber(value)
  if (parsed === null || !Number.isInteger(parsed)) {
    return null
  }

  return parsed
}

const requiredBoolean = (value: JsonValue | undefined): boolean | null => {
  if (!hasPresentValue(value)) {
    return null
  }

  if (typeof value === 'boolean') {
    return value
  }

  const normalized = String(value).trim().toLowerCase()
  if (['true', 'yes', 'y', '1', 'oui'].includes(normalized)) {
    return true
  }
  if (['false', 'no', 'n', '0', 'non'].includes(normalized)) {
    return false
  }

  return null
}

const requiredDate = (value: JsonValue | undefined): Date | null => {
  if (!hasPresentValue(value)) {
    return null
  }

  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

const claimFieldValue = (
  values: NormalizedMappedValue[],
  path: typeof CLAIM_REQUIRED_PATHS[number]
): JsonValue | undefined => mappedValueForPath(values, CLAIM_ENTITY, path)?.value

const claimLineItemFieldValue = (
  values: NormalizedMappedValue[],
  path: typeof CLAIM_LINE_ITEM_REQUIRED_PATHS[number]
): JsonValue | undefined => mappedValueForPath(values, CLAIM_LINE_ITEM_ENTITY, path)?.value

const prepareClaimInput = async (
  rawDb: unknown,
  input: ClaimMaterializationInput,
  values: NormalizedMappedValue[]
): Promise<{ claim?: PreparedClaim; issues: GcsGcFormsMappingIssue[] }> => {
  const db = asGcFormsIntegrationDb(rawDb)
  const issues: GcsGcFormsMappingIssue[] = []

  for (const path of CLAIM_REQUIRED_PATHS) {
    if (!hasPresentValue(claimFieldValue(values, path))) {
      issues.push(createIssue(
        input.mappings,
        CLAIM_ENTITY,
        path,
        'missing_required_value',
        'Required claim materialization value is missing.'
      ))
    }
  }

  if (issues.length > 0) {
    return { issues }
  }

  const agreementNumber = requiredString(claimFieldValue(values, CLAIM_AGREEMENT_NUMBER_PATH))
  const fiscalYearId = requiredString(claimFieldValue(values, 'egcs_fc_fiscalyear'))
  const isFinalForYear = requiredBoolean(claimFieldValue(values, 'egcs_fc_isfinalforyear'))
  const periodStart = requiredInteger(claimFieldValue(values, 'egcs_fc_periodstart'))
  const periodEnd = requiredInteger(claimFieldValue(values, 'egcs_fc_periodend'))
  const receivedDate = requiredDate(claimFieldValue(values, 'egcs_fc_receiveddate'))

  if (!agreementNumber || !fiscalYearId || isFinalForYear === null || periodStart === null || periodEnd === null || !receivedDate) {
    return {
      issues: [createIssue(
        input.mappings,
        CLAIM_ENTITY,
        CLAIM_AGREEMENT_NUMBER_PATH,
        'invalid_value',
        'Claim materialization values could not be coerced into the host claim fields.'
      )]
    }
  }

  if (periodStart < 0 || periodStart > 11 || periodEnd < 0 || periodEnd > 11 || periodStart > periodEnd) {
    return {
      issues: [createIssue(
        input.mappings,
        CLAIM_ENTITY,
        'egcs_fc_periodend',
        'invalid_value',
        'Claim period must be within a single valid fiscal year range.'
      )]
    }
  }

  const agreementOverride = await db
    .selectFrom('extensions.gcs_gcforms_materialization_overrides')
    .select('owner_id')
    .where('submission_id', '=', input.submissionId)
    .where('destination_entity', '=', CLAIM_ENTITY)
    .where('destination_path', '=', CLAIM_AGREEMENT_NUMBER_PATH)
    .where('owner_type', '=', AGREEMENT_OWNER_TYPE)
    .where('_deleted', '=', false)
    .executeTakeFirst()

  const agreement = agreementOverride
    ? await db
        .selectFrom('Funding_Case_Agreement_Profile')
        .select(['id', 'egcs_fc_agreementnumber'])
        .where('id', '=', String(agreementOverride.owner_id))
        .where('egcs_fc_transferpaymentstream', '=', input.streamId)
        .where('_deleted', '=', false)
        .executeTakeFirst()
    : await db
        .selectFrom('Funding_Case_Agreement_Profile')
        .select(['id', 'egcs_fc_agreementnumber'])
        .where('egcs_fc_transferpaymentstream', '=', input.streamId)
        .where('egcs_fc_agreementnumber', '=', agreementNumber)
        .where('_deleted', '=', false)
        .executeTakeFirst()

  if (!agreement) {
    return {
      issues: [createIssue(
        input.mappings,
        CLAIM_ENTITY,
        CLAIM_AGREEMENT_NUMBER_PATH,
        agreementOverride ? 'invalid_value' : 'agreement_not_found',
        agreementOverride
          ? 'Selected agreement is no longer available in the configured transfer payment stream.'
          : 'Agreement number could not be resolved in the configured transfer payment stream.'
      )]
    }
  }

  const fiscalYear = await db
    .selectFrom('Funding_Case_Agreement_Budget_Fiscal_Year')
    .select('id')
    .where('id', '=', fiscalYearId)
    .where('egcs_fc_fundingagreement', '=', String(agreement.id))
    .where('_deleted', '=', false)
    .executeTakeFirst()

  if (!fiscalYear) {
    return {
      issues: [createIssue(
        input.mappings,
        CLAIM_ENTITY,
        'egcs_fc_fiscalyear',
        'invalid_value',
        'Claim fiscal year is not valid for the resolved agreement.'
      )]
    }
  }

  const agreementMapping = mappingForPath(input.mappings, CLAIM_ENTITY, CLAIM_AGREEMENT_NUMBER_PATH)

  return {
    claim: {
      agreementId: String(agreement.id),
      agreementNumber: String(agreement.egcs_fc_agreementnumber),
      agreementMappingId: agreementMapping ? agreementMapping.id : '',
      fiscalYearId,
      isFinalForYear,
      periodStart,
      periodEnd,
      receivedDate
    },
    issues: []
  }
}

const prepareClaimLineItemInput = async (
  rawDb: unknown,
  input: ClaimMaterializationInput,
  claim: PreparedClaim,
  values: NormalizedMappedValue[]
): Promise<{ lineItem?: PreparedClaimLineItem; issues: GcsGcFormsMappingIssue[] }> => {
  const db = asGcFormsIntegrationDb(rawDb)
  const hasAnyLineItemValue = CLAIM_LINE_ITEM_REQUIRED_PATHS.some(path =>
    hasPresentValue(claimLineItemFieldValue(values, path))
  )

  if (!hasAnyLineItemValue && !hasMaterializationMapping(input.mappings, CLAIM_LINE_ITEM_ENTITY)) {
    return { issues: [] }
  }

  if (!hasAnyLineItemValue) {
    return { issues: [] }
  }

  const issues: GcsGcFormsMappingIssue[] = []
  for (const path of CLAIM_LINE_ITEM_REQUIRED_PATHS) {
    if (!hasPresentValue(claimLineItemFieldValue(values, path))) {
      issues.push(createIssue(
        input.mappings,
        CLAIM_LINE_ITEM_ENTITY,
        path,
        'missing_required_value',
        'Required claim line item materialization value is missing.'
      ))
    }
  }

  if (issues.length > 0) {
    return { issues }
  }

  const budgetLineItemId = requiredString(claimLineItemFieldValue(values, 'egcs_fc_fundingagreementbudgetlineitem'))
  const description = requiredString(claimLineItemFieldValue(values, 'egcs_fc_description'))
  const amount = requiredNumber(claimLineItemFieldValue(values, 'egcs_fc_amount'))
  const currency = requiredString(claimLineItemFieldValue(values, 'egcs_fc_currency'))

  if (!budgetLineItemId || !description || amount === null || !currency) {
    return {
      issues: [createIssue(
        input.mappings,
        CLAIM_LINE_ITEM_ENTITY,
        'egcs_fc_fundingagreementbudgetlineitem',
        'invalid_value',
        'Claim line item values could not be coerced into the host claim line fields.'
      )]
    }
  }

  const budgetLineItem = await db
    .selectFrom('Funding_Case_Agreement_Budget_Line_Item')
    .innerJoin(
      'Funding_Case_Agreement_Budget_Fiscal_Year',
      'Funding_Case_Agreement_Budget_Fiscal_Year.id',
      'Funding_Case_Agreement_Budget_Line_Item.egcs_fc_fundingagreementbudgetfiscalyear'
    )
    .select('Funding_Case_Agreement_Budget_Line_Item.id as id')
    .where('Funding_Case_Agreement_Budget_Line_Item.id', '=', budgetLineItemId)
    .where('Funding_Case_Agreement_Budget_Line_Item.egcs_fc_fundingagreementbudgetfiscalyear', '=', claim.fiscalYearId)
    .where('Funding_Case_Agreement_Budget_Fiscal_Year.egcs_fc_fundingagreement', '=', claim.agreementId)
    .where('Funding_Case_Agreement_Budget_Line_Item._deleted', '=', false)
    .where('Funding_Case_Agreement_Budget_Fiscal_Year._deleted', '=', false)
    .executeTakeFirst()

  if (!budgetLineItem) {
    return {
      issues: [createIssue(
        input.mappings,
        CLAIM_LINE_ITEM_ENTITY,
        'egcs_fc_fundingagreementbudgetlineitem',
        'invalid_value',
        'Claim line item budget line item is not valid for the claim fiscal year.'
      )]
    }
  }

  const budgetLineItemMapping = mappingForPath(input.mappings, CLAIM_LINE_ITEM_ENTITY, 'egcs_fc_fundingagreementbudgetlineitem')

  return {
    lineItem: {
      budgetLineItemId,
      budgetLineItemMappingId: budgetLineItemMapping ? budgetLineItemMapping.id : '',
      description,
      amount,
      currency
    },
    issues: []
  }
}

const fieldMappingIdsByKey = async (
  rawDb: unknown,
  integrationId: string
): Promise<Map<string, string>> => {
  const db = asGcFormsIntegrationDb(rawDb)
  const rows = await db
    .selectFrom('extensions.gcs_gcforms_field_mappings')
    .select(['id', 'mapping_key'])
    .where('integration_id', '=', integrationId)
    .where('_deleted', '=', false)
    .execute()

  return new Map(rows.map(row => [row.mapping_key, String(row.id)]))
}

const existingClaimLink = async (
  rawDb: unknown,
  submissionId: string
) => {
  const db = asGcFormsIntegrationDb(rawDb)
  return await db
    .selectFrom('extensions.gcs_gcforms_destination_links')
    .select(['owner_id'])
    .where('submission_id', '=', submissionId)
    .where('owner_type', '=', CLAIM_OWNER_TYPE)
    .where('destination_entity', '=', CLAIM_ENTITY)
    .where('_deleted', '=', false)
    .executeTakeFirst()
}

const claimLinkValue = (claimId: string, claim: PreparedClaim): JsonValue => ({
  claimId,
  agreementId: claim.agreementId,
  agreementNumber: claim.agreementNumber,
  fiscalYearId: claim.fiscalYearId,
  isFinalForYear: claim.isFinalForYear,
  periodStart: claim.periodStart,
  periodEnd: claim.periodEnd,
  receivedDate: claim.receivedDate.toISOString()
})

const lineItemLinkValue = (lineItemId: string, lineItem: PreparedClaimLineItem): JsonValue => ({
  lineItemId,
  budgetLineItemId: lineItem.budgetLineItemId,
  description: lineItem.description,
  amount: lineItem.amount,
  currency: lineItem.currency
})

export const materializeGcFormsClaimSubmission = async (
  rawDb: unknown,
  input: ClaimMaterializationInput
): Promise<ClaimMaterializationResult> => {
  const hasClaimMappings = hasMaterializationMapping(input.mappings, CLAIM_ENTITY)
  const hasLineItemMappings = hasMaterializationMapping(input.mappings, CLAIM_LINE_ITEM_ENTITY)
  const existing = await existingClaimLink(rawDb, input.submissionId)

  if (existing) {
    return {
      status: 'already_materialized',
      claimId: String(existing.owner_id),
      lineItemIds: [],
      issues: []
    }
  }

  if (!hasClaimMappings && !hasLineItemMappings) {
    return {
      status: 'not_applicable',
      lineItemIds: [],
      issues: []
    }
  }

  const values = normalizeMappedValues(input.mappedValues)
  const preparedClaim = await prepareClaimInput(rawDb, input, values)
  if (!preparedClaim.claim) {
    return {
      status: 'failed',
      lineItemIds: [],
      issues: preparedClaim.issues
    }
  }
  const claimInput = preparedClaim.claim

  const preparedLineItem = await prepareClaimLineItemInput(rawDb, input, claimInput, values)
  if (preparedLineItem.issues.length > 0) {
    return {
      status: 'failed',
      lineItemIds: [],
      issues: preparedLineItem.issues
    }
  }

  const db = asGcFormsIntegrationDb(rawDb)
  const mappingIdsByKey = await fieldMappingIdsByKey(rawDb, input.integrationId)

  return await db.transaction().execute(async trx => {
    const claimValues: ClaimInsert = {
      egcs_fc_fundingagreement: claimInput.agreementId,
      egcs_fc_fiscalyear: claimInput.fiscalYearId,
      egcs_fc_isfinalforyear: claimInput.isFinalForYear,
      egcs_fc_periodstart: claimInput.periodStart,
      egcs_fc_periodend: claimInput.periodEnd,
      egcs_fc_receiveddate: claimInput.receivedDate,
      egcs_fc_status: 'draft'
    }

    const claim = await trx
      .insertInto('Funding_Case_Agreement_Claim')
      .values(claimValues)
      .returningAll()
      .executeTakeFirstOrThrow()

    const claimId = String(claim.id)
    await trx
      .insertInto('extensions.gcs_gcforms_destination_links')
      .values({
        submission_id: input.submissionId,
        mapping_id: mappingIdsByKey.get(claimInput.agreementMappingId) ?? null,
        owner_type: getGcFormsDestinationOwnerType(CLAIM_ENTITY),
        owner_id: claimId,
        destination_entity: CLAIM_ENTITY,
        destination_path: CLAIM_ENTITY,
        value: claimLinkValue(claimId, claimInput) as never
      })
      .execute()

    const lineItemIds: string[] = []
    if (preparedLineItem.lineItem) {
      const lineValues: ClaimLineItemInsert = {
        egcs_fc_fundingagreementclaim: claimId,
        egcs_fc_fundingagreementbudgetlineitem: preparedLineItem.lineItem.budgetLineItemId,
        egcs_fc_description: preparedLineItem.lineItem.description,
        egcs_fc_amount: preparedLineItem.lineItem.amount,
        egcs_fc_currency: preparedLineItem.lineItem.currency
      }

      const lineItem = await trx
        .insertInto('Funding_Case_Agreement_Claim_Line_Item')
        .values(lineValues)
        .returningAll()
        .executeTakeFirstOrThrow()

      const lineItemId = String(lineItem.id)
      lineItemIds.push(lineItemId)
      await trx
        .insertInto('extensions.gcs_gcforms_destination_links')
        .values({
          submission_id: input.submissionId,
          mapping_id: mappingIdsByKey.get(preparedLineItem.lineItem.budgetLineItemMappingId) ?? null,
          owner_type: getGcFormsDestinationOwnerType(CLAIM_LINE_ITEM_ENTITY),
          owner_id: lineItemId,
          destination_entity: CLAIM_LINE_ITEM_ENTITY,
          destination_path: CLAIM_LINE_ITEM_ENTITY,
          value: lineItemLinkValue(lineItemId, preparedLineItem.lineItem) as never
        })
        .execute()
    }

    return {
      status: 'created',
      claimId,
      lineItemIds,
      issues: []
    }
  })
}
