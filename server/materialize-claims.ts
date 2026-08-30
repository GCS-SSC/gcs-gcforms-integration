import { sql } from 'kysely'
import type { JsonValue } from '@gcs-ssc/extensions'
import {
  createGcsExtensionUserError,
  type GcsExtensionAgreementClaimCreateInput,
  type GcsExtensionAgreementClaimCreateResult
} from '@gcs-ssc/extensions/server'
import type {
  GcsDestinationEntity,
  GcsGcFormsFieldMapping,
  GcsGcFormsMappedValue,
  GcsGcFormsMappingIssue
} from '../shared/gcforms.ts'
import { coerceGcFormsMoney } from '../shared/gcforms.ts'
import { asGcFormsIntegrationDb, executeGcFormsTransaction } from './db.ts'
import { gcFormsJsonbValue } from './jsonb.ts'

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
  agencyId: string
  streamId: string
  integrationId: string
  submissionId: string
  submissionUuid: string
  submissionStatusId: string
  mappings: GcsGcFormsFieldMapping[]
  mappedValues: GcsGcFormsMappedValue[]
  createAgreementClaim: (
    input: GcsExtensionAgreementClaimCreateInput
  ) => Promise<GcsExtensionAgreementClaimCreateResult>
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
  budgetLineItemId: string | null
  budgetLineItemMappingId: string
  submittedCostCategory: string | null
  submittedCostSubsection: string | null
  submittedLineItem: string | null
  description: string
  amount: string
  currency: string
}

interface NormalizedClaimInputValues {
  agreementNumber: string | null
  fiscalYearValue: string | null
  isFinalForYear: boolean | null
  periodStart: number | null
  periodEnd: number | null
  receivedDate: Date | null
}

interface ResolvedClaimAgreement {
  agreementId: string
  agreementNumber: string
  hasOverride: boolean
}

export interface ClaimMaterializationResult {
  status: 'not_applicable' | 'created' | 'already_materialized' | 'failed'
  claimId?: string
  lineItemIds: string[]
  issues: GcsGcFormsMappingIssue[]
}

const createSubmissionStatusUnavailableError = () => createGcsExtensionUserError({
  statusCode: 409,
  code: 'GCS_GCFORMS_SUBMISSION_STATUS_UNAVAILABLE',
  message: {
    en: 'The configured imported claim status is no longer available for this agency.',
    fr: 'Le statut configuré des réclamations importées n’est plus disponible pour cette organisation.'
  }
})

const createSubmissionStatusNotDraftError = () => createGcsExtensionUserError({
  statusCode: 409,
  code: 'GCS_GCFORMS_SUBMISSION_STATUS_NOT_DRAFT',
  message: {
    en: 'Claims imported from GC Forms must use the agency Draft status.',
    fr: 'Les réclamations importées de GC Forms doivent utiliser le statut Brouillon de l’organisation.'
  }
})

const createClaimAgreementUnavailableError = () => createGcsExtensionUserError({
  statusCode: 409,
  code: 'GCS_GCFORMS_AGREEMENT_UNAVAILABLE',
  message: {
    en: 'The selected agreement is no longer available for this stream.',
    fr: 'L’entente sélectionnée n’est plus disponible pour ce volet.'
  }
})

const createClaimFiscalYearUnavailableError = () => createGcsExtensionUserError({
  statusCode: 409,
  code: 'GCS_GCFORMS_CLAIM_FISCAL_YEAR_UNAVAILABLE',
  message: {
    en: 'The selected claim fiscal year is no longer available for this agreement.',
    fr: 'L’exercice financier sélectionné pour la réclamation n’est plus disponible pour cette entente.'
  }
})

const requireCreatedAgreementClaim = (
  result: GcsExtensionAgreementClaimCreateResult
): Extract<GcsExtensionAgreementClaimCreateResult, { status: 'created' }> => {
  if (result.status === 'created') return result
  if (result.status === 'agreement_unavailable') throw createClaimAgreementUnavailableError()
  if (result.status === 'fiscal_year_unavailable') throw createClaimFiscalYearUnavailableError()
  if (result.status === 'requested_status_not_draft') throw createSubmissionStatusNotDraftError()
  throw createSubmissionStatusUnavailableError()
}

const CLAIM_ENTITY: GcsDestinationEntity = 'claim'
const CLAIM_LINE_ITEM_ENTITY: GcsDestinationEntity = 'claim_line_item'
const MATERIALIZED_DESTINATION_ENTITIES = new Set<GcsDestinationEntity>([
  CLAIM_ENTITY,
  CLAIM_LINE_ITEM_ENTITY
])

const AGREEMENT_OWNER_TYPE: DestinationOwnerType = 'fundingcaseagreement'
const CLAIM_OWNER_TYPE: DestinationOwnerType = 'fundingcaseagreementclaim'
const CLAIM_LINE_ITEM_OWNER_TYPE: DestinationOwnerType = 'fundingcaseagreementclaimlineitem'

export const CLAIM_AGREEMENT_NUMBER_PATH = 'egcs_fc_fundingagreement'
export const CLAIM_AGREEMENT_DESTINATION_PATH = `${CLAIM_ENTITY}.${CLAIM_AGREEMENT_NUMBER_PATH}`
const CLAIM_REQUIRED_PATHS = [
  CLAIM_AGREEMENT_NUMBER_PATH,
  'egcs_fc_fiscalyear',
  'egcs_fc_periodstart',
  'egcs_fc_periodend',
  'egcs_fc_receiveddate'
] as const
type ClaimPath = typeof CLAIM_REQUIRED_PATHS[number] | 'egcs_fc_isfinalforyear'

const CLAIM_LINE_ITEM_REQUIRED_PATHS = [
  'egcs_fc_submittedcostcategory',
  'egcs_fc_submittedcostsubsection',
  'egcs_fc_submittedlineitem',
  'egcs_fc_amount'
] as const

const CLAIM_LINE_ITEM_OPTIONAL_PATHS = [
  'egcs_fc_fundingagreementbudgetlineitem',
  'egcs_fc_description',
  'egcs_fc_currency'
] as const

const CLAIM_LINE_ITEM_PATHS = [
  ...CLAIM_LINE_ITEM_REQUIRED_PATHS,
  ...CLAIM_LINE_ITEM_OPTIONAL_PATHS
] as const

const FISCAL_YEAR_MONTHS = [
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'january',
  'february',
  'march'
]

/** Maps each GC Forms destination entity to the host owner type used by destination links. */
const getGcFormsDestinationOwnerType = (entity: GcsDestinationEntity): DestinationOwnerType => {
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

const optionalBooleanDefaultFalse = (value: JsonValue | undefined): boolean | null =>
  hasPresentValue(value) ? requiredBoolean(value) : false

const createIssue = (
  mappings: GcsGcFormsFieldMapping[],
  entity: GcsDestinationEntity,
  path: string,
  code: GcsGcFormsMappingIssue['code'],
  params: GcsGcFormsMappingIssue['params'] = {}
): GcsGcFormsMappingIssue => {
  const mapping = mappingForPath(mappings, entity, path)
  const destinationPath = `${entity}.${path}`
  return {
    mappingId: mapping ? mapping.id : '',
    sourceQuestionId: mapping ? mapping.sourceQuestionId : '',
    destinationPath,
    code,
    params: {
      ...params,
      destinationPath
    }
  }
}

/** Returns stable issues for configured destinations this materializer cannot persist. */
export const getUnsupportedGcFormsMaterializationIssues = (
  mappings: GcsGcFormsFieldMapping[]
): GcsGcFormsMappingIssue[] => mappings
  .filter(mapping => !MATERIALIZED_DESTINATION_ENTITIES.has(mapping.destinationEntity))
  .map(mapping => ({
    mappingId: mapping.id,
    sourceQuestionId: mapping.sourceQuestionId,
    destinationPath: mapping.destinationPath,
    code: 'unsupported_destination',
    params: {
      destinationEntity: mapping.destinationEntity,
      destinationPath: mapping.destinationPath
    }
  }))

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

const requiredMoney = (value: JsonValue | undefined): string | null => {
  if (!hasPresentValue(value)) {
    return null
  }

  try {
    return coerceGcFormsMoney(value)
  } catch {
    return null
  }
}

const requiredInteger = (value: JsonValue | undefined): number | null => {
  const parsed = requiredNumber(value)
  if (parsed === null || !Number.isInteger(parsed)) {
    return null
  }

  return parsed
}

const requiredFiscalYearMonthIndex = (value: JsonValue | undefined): number | null => {
  const parsed = requiredInteger(value)
  if (parsed !== null) {
    return parsed
  }

  if (!hasPresentValue(value)) {
    return null
  }

  const normalized = String(value).trim().toLowerCase()
  const index = FISCAL_YEAR_MONTHS.indexOf(normalized)
  return index === -1 ? null : index
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
  path: ClaimPath
): JsonValue | undefined => mappedValueForPath(values, CLAIM_ENTITY, path)?.value

const claimLineItemFieldValue = (
  values: NormalizedMappedValue[],
  path: typeof CLAIM_LINE_ITEM_PATHS[number],
  index?: number
): JsonValue | undefined => {
  const value = mappedValueForPath(values, CLAIM_LINE_ITEM_ENTITY, path)?.value
  if (Array.isArray(value) && index !== undefined) {
    return value[index]
  }

  return value
}

/** Resolves a claim fiscal-year value by budget-year identifier or display label for an agreement. */
const resolveClaimFiscalYearId = async (
  rawDb: unknown,
  agreementId: string,
  fiscalYearValue: string
): Promise<string | null> => {
  const db = asGcFormsIntegrationDb(rawDb)
  if (/^\d+$/.test(fiscalYearValue)) {
    const fiscalYear = await db
      .selectFrom('Funding_Case_Agreement_Budget_Fiscal_Year')
      .select('id')
      .where('id', '=', fiscalYearValue)
      .where('egcs_fc_fundingagreement', '=', agreementId)
      .where('_deleted', '=', false)
      .executeTakeFirst()

    return fiscalYear ? String(fiscalYear.id) : null
  }

  const fiscalYear = await db
    .selectFrom('Funding_Case_Agreement_Budget_Fiscal_Year')
    .innerJoin('Agency_Fiscal_Year', 'Agency_Fiscal_Year.id', 'Funding_Case_Agreement_Budget_Fiscal_Year.egcs_fc_fiscalyear')
    .select('Funding_Case_Agreement_Budget_Fiscal_Year.id as id')
    .where('Funding_Case_Agreement_Budget_Fiscal_Year.egcs_fc_fundingagreement', '=', agreementId)
    .where('Agency_Fiscal_Year.egcs_ay_fiscalyeardisplay', '=', fiscalYearValue)
    .where('Funding_Case_Agreement_Budget_Fiscal_Year._deleted', '=', false)
    .where('Agency_Fiscal_Year._deleted', '=', false)
    .executeTakeFirst()

  return fiscalYear ? String(fiscalYear.id) : null
}

/** Reports required claim fields that do not contain a materializable value. */
const collectMissingClaimIssues = (
  input: ClaimMaterializationInput,
  values: NormalizedMappedValue[]
): GcsGcFormsMappingIssue[] => {
  const issues: GcsGcFormsMappingIssue[] = []

  for (const path of CLAIM_REQUIRED_PATHS) {
    if (!hasPresentValue(claimFieldValue(values, path))) {
      issues.push(createIssue(
        input.mappings,
        CLAIM_ENTITY,
        path,
        'claim_required_value_missing'
      ))
    }
  }

  return issues
}

const getNormalizedClaimInputValues = (
  values: NormalizedMappedValue[]
): NormalizedClaimInputValues => ({
  agreementNumber: requiredString(claimFieldValue(values, CLAIM_AGREEMENT_NUMBER_PATH)),
  fiscalYearValue: requiredString(claimFieldValue(values, 'egcs_fc_fiscalyear')),
  isFinalForYear: optionalBooleanDefaultFalse(claimFieldValue(values, 'egcs_fc_isfinalforyear')),
  periodStart: requiredFiscalYearMonthIndex(claimFieldValue(values, 'egcs_fc_periodstart')),
  periodEnd: requiredFiscalYearMonthIndex(claimFieldValue(values, 'egcs_fc_periodend')),
  receivedDate: requiredDate(claimFieldValue(values, 'egcs_fc_receiveddate'))
})

const claimInputValuesAreComplete = (
  values: NormalizedClaimInputValues
): values is NormalizedClaimInputValues & {
  agreementNumber: string
  fiscalYearValue: string
  isFinalForYear: boolean
  periodStart: number
  periodEnd: number
  receivedDate: Date
} =>
  Boolean(values.agreementNumber)
  && Boolean(values.fiscalYearValue)
  && values.isFinalForYear !== null
  && values.periodStart !== null
  && values.periodEnd !== null
  && values.receivedDate !== null

const claimPeriodIsValid = (periodStart: number, periodEnd: number): boolean =>
  periodStart >= 0 && periodStart <= 11 && periodEnd >= 0 && periodEnd <= 11 && periodStart <= periodEnd

const findClaimAgreementOverride = async (
  rawDb: unknown,
  input: ClaimMaterializationInput
) => {
  const db = asGcFormsIntegrationDb(rawDb)
  return await db
    .selectFrom('extensions.gcs_gcforms_materialization_overrides')
    .select('owner_id')
    .where('submission_id', '=', input.submissionId)
    .where('destination_entity', '=', CLAIM_ENTITY)
    .where('destination_path', '=', CLAIM_AGREEMENT_NUMBER_PATH)
    .where('owner_type', '=', AGREEMENT_OWNER_TYPE)
    .where('_deleted', '=', false)
    .executeTakeFirst()
}

/** Resolves the claim agreement from a manual override or its submitted agreement number. */
const resolveClaimAgreement = async (
  rawDb: unknown,
  input: ClaimMaterializationInput,
  agreementNumber: string
): Promise<ResolvedClaimAgreement | null> => {
  const db = asGcFormsIntegrationDb(rawDb)
  const agreementOverride = await findClaimAgreementOverride(rawDb, input)
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

  return agreement
    ? {
        agreementId: String(agreement.id),
        agreementNumber: String(agreement.egcs_fc_agreementnumber),
        hasOverride: Boolean(agreementOverride)
      }
    : null
}

/** Validates and resolves mapped claim values into a host-ready claim record. */
const prepareClaimInput = async (
  rawDb: unknown,
  input: ClaimMaterializationInput,
  values: NormalizedMappedValue[]
): Promise<{ claim?: PreparedClaim; issues: GcsGcFormsMappingIssue[] }> => {
  const issues = collectMissingClaimIssues(input, values)
  if (issues.length > 0) {
    return { issues }
  }

  const claimValues = getNormalizedClaimInputValues(values)
  if (!claimInputValuesAreComplete(claimValues)) {
    return {
      issues: [createIssue(
        input.mappings,
        CLAIM_ENTITY,
        CLAIM_AGREEMENT_NUMBER_PATH,
        'claim_values_invalid'
      )]
    }
  }

  if (!claimPeriodIsValid(claimValues.periodStart, claimValues.periodEnd)) {
    return {
      issues: [createIssue(
        input.mappings,
        CLAIM_ENTITY,
        'egcs_fc_periodend',
        'claim_period_invalid'
      )]
    }
  }

  const agreement = await resolveClaimAgreement(rawDb, input, claimValues.agreementNumber)
  if (!agreement) {
    const hasOverride = Boolean(await findClaimAgreementOverride(rawDb, input))
    return {
      issues: [createIssue(
        input.mappings,
        CLAIM_ENTITY,
        CLAIM_AGREEMENT_NUMBER_PATH,
        hasOverride ? 'agreement_override_unavailable' : 'agreement_not_found'
      )]
    }
  }

  const fiscalYearId = await resolveClaimFiscalYearId(rawDb, agreement.agreementId, claimValues.fiscalYearValue)

  if (!fiscalYearId) {
    return {
      issues: [createIssue(
        input.mappings,
        CLAIM_ENTITY,
        'egcs_fc_fiscalyear',
        'claim_fiscal_year_invalid'
      )]
    }
  }

  const agreementMapping = mappingForPath(input.mappings, CLAIM_ENTITY, CLAIM_AGREEMENT_NUMBER_PATH)

  return {
    claim: {
      agreementId: agreement.agreementId,
      agreementNumber: agreement.agreementNumber,
      agreementMappingId: agreementMapping ? agreementMapping.id : '',
      fiscalYearId,
      isFinalForYear: claimValues.isFinalForYear,
      periodStart: claimValues.periodStart,
      periodEnd: claimValues.periodEnd,
      receivedDate: claimValues.receivedDate
    },
    issues: []
  }
}

const normalizedText = (value: string): string => value.trim().toLowerCase()

const mappedValueLength = (values: NormalizedMappedValue[], path: typeof CLAIM_LINE_ITEM_PATHS[number]): number => {
  const value = mappedValueForPath(values, CLAIM_LINE_ITEM_ENTITY, path)?.value
  return Array.isArray(value) ? value.length : hasPresentValue(value) ? 1 : 0
}

const claimLineItemValueCount = (values: NormalizedMappedValue[]): number =>
  CLAIM_LINE_ITEM_PATHS.reduce((count, path) => Math.max(count, mappedValueLength(values, path)), 0)

const hasAnyClaimLineItemValue = (values: NormalizedMappedValue[], index: number): boolean => CLAIM_LINE_ITEM_PATHS.some(path =>
  hasPresentValue(claimLineItemFieldValue(values, path, index))
)

const collectMissingClaimLineItemIssues = (
  input: ClaimMaterializationInput,
  values: NormalizedMappedValue[],
  index: number
): GcsGcFormsMappingIssue[] => CLAIM_LINE_ITEM_REQUIRED_PATHS
  .filter(path => !hasPresentValue(claimLineItemFieldValue(values, path, index)))
  .map(path => createIssue(
    input.mappings,
    CLAIM_LINE_ITEM_ENTITY,
    path,
    'claim_line_item_required_value_missing',
    { row: index + 1 }
  ))

const readClaimLineItemValues = (values: NormalizedMappedValue[], index: number) => ({
  budgetLineItemId: requiredString(claimLineItemFieldValue(values, 'egcs_fc_fundingagreementbudgetlineitem', index)),
  submittedCostCategory: requiredString(claimLineItemFieldValue(values, 'egcs_fc_submittedcostcategory', index)),
  submittedCostSubsection: requiredString(claimLineItemFieldValue(values, 'egcs_fc_submittedcostsubsection', index)),
  submittedLineItem: requiredString(claimLineItemFieldValue(values, 'egcs_fc_submittedlineitem', index)),
  description: requiredString(claimLineItemFieldValue(values, 'egcs_fc_description', index)),
  amount: requiredMoney(claimLineItemFieldValue(values, 'egcs_fc_amount', index)),
  currency: requiredString(claimLineItemFieldValue(values, 'egcs_fc_currency', index))
})

const invalidClaimLineItemValuesIssue = (
  input: ClaimMaterializationInput,
  index: number
): GcsGcFormsMappingIssue => createIssue(
  input.mappings,
  CLAIM_LINE_ITEM_ENTITY,
  'egcs_fc_amount',
  'claim_line_item_values_invalid',
  { row: index + 1 }
)

const lineItemDescription = (
  description: string | null,
  submittedCostCategory: string,
  submittedCostSubsection: string,
  submittedLineItem: string
): string => description || `${submittedCostCategory} / ${submittedCostSubsection} / ${submittedLineItem}`

/** Finds the agreement budget line matching submitted bilingual category, subsection, and line-item labels. */
const fetchMatchingClaimLineItemBudgetLineItem = async (
  rawDb: unknown,
  claim: PreparedClaim,
  submittedCostCategory: string,
  submittedCostSubsection: string,
  submittedLineItem: string
) => {
  const db = asGcFormsIntegrationDb(rawDb)
  const costCategory = normalizedText(submittedCostCategory)
  const costSubsection = normalizedText(submittedCostSubsection)
  const lineItem = normalizedText(submittedLineItem)

  return await db
    .selectFrom('Funding_Case_Agreement_Budget_Line_Item')
    .innerJoin(
      'Funding_Case_Agreement_Budget_Fiscal_Year',
      'Funding_Case_Agreement_Budget_Fiscal_Year.id',
      'Funding_Case_Agreement_Budget_Line_Item.egcs_fc_fundingagreementbudgetfiscalyear'
    )
    .innerJoin(
      'Transfer_Payment_Stream_Cost_Category_Line_Item',
      'Transfer_Payment_Stream_Cost_Category_Line_Item.id',
      'Funding_Case_Agreement_Budget_Line_Item.egcs_fc_organizationcostcategory'
    )
    .innerJoin(
      'Agency_Cost_Category_Line_Item',
      'Agency_Cost_Category_Line_Item.id',
      'Transfer_Payment_Stream_Cost_Category_Line_Item.egcs_tp_organizationcostcategory'
    )
    .innerJoin(
      'Agency_Cost_Category',
      'Agency_Cost_Category.id',
      'Agency_Cost_Category_Line_Item.egcs_ay_organizationcostcategory'
    )
    .select('Funding_Case_Agreement_Budget_Line_Item.id as id')
    .where('Funding_Case_Agreement_Budget_Line_Item.egcs_fc_fundingagreementbudgetfiscalyear', '=', claim.fiscalYearId)
    .where('Funding_Case_Agreement_Budget_Fiscal_Year.egcs_fc_fundingagreement', '=', claim.agreementId)
    .where('Funding_Case_Agreement_Budget_Line_Item._deleted', '=', false)
    .where('Funding_Case_Agreement_Budget_Fiscal_Year._deleted', '=', false)
    .where('Transfer_Payment_Stream_Cost_Category_Line_Item._deleted', '=', false)
    .where('Agency_Cost_Category_Line_Item._deleted', '=', false)
    .where('Agency_Cost_Category._deleted', '=', false)
    .where(sql<boolean>`lower("Funding_Case_Agreement_Budget_Line_Item"."egcs_fc_costsubsection") = ${costSubsection}`)
    .where(sql<boolean>`(
      lower("Agency_Cost_Category"."egcs_ay_name_en") = ${costCategory}
      OR lower("Agency_Cost_Category"."egcs_ay_name_fr") = ${costCategory}
    )`)
    .where(sql<boolean>`(
      lower("Agency_Cost_Category_Line_Item"."egcs_ay_name_en") = ${lineItem}
      OR lower("Agency_Cost_Category_Line_Item"."egcs_ay_name_fr") = ${lineItem}
    )`)
    .executeTakeFirst()
}

/** Validates repeated line-item values and optionally associates each valid item with a matching budget line, leaving unmatched associations null. */
const prepareClaimLineItemInputs = async (
  rawDb: unknown,
  input: ClaimMaterializationInput,
  claim: PreparedClaim,
  values: NormalizedMappedValue[]
): Promise<{ lineItems: PreparedClaimLineItem[]; issues: GcsGcFormsMappingIssue[] }> => {
  const lineItemCount = claimLineItemValueCount(values)

  if (lineItemCount === 0 && !hasMaterializationMapping(input.mappings, CLAIM_LINE_ITEM_ENTITY)) {
    return { lineItems: [], issues: [] }
  }

  if (lineItemCount === 0) {
    return { lineItems: [], issues: [] }
  }

  const lineItems: PreparedClaimLineItem[] = []
  const issues: GcsGcFormsMappingIssue[] = []

  for (let index = 0; index < lineItemCount; index += 1) {
    if (!hasAnyClaimLineItemValue(values, index)) {
      continue
    }

    const rowMissingIssues = collectMissingClaimLineItemIssues(input, values, index)
    if (rowMissingIssues.length > 0) {
      issues.push(...rowMissingIssues)
      continue
    }

    const {
      submittedCostCategory,
      submittedCostSubsection,
      submittedLineItem,
      description,
      amount,
      currency
    } = readClaimLineItemValues(values, index)

    if (!submittedCostCategory || !submittedCostSubsection || !submittedLineItem || amount === null) {
      issues.push(invalidClaimLineItemValuesIssue(input, index))
      continue
    }

    const matchedBudgetLineItem = await fetchMatchingClaimLineItemBudgetLineItem(
      rawDb,
      claim,
      submittedCostCategory,
      submittedCostSubsection,
      submittedLineItem
    )

    const budgetLineItemMapping = mappingForPath(input.mappings, CLAIM_LINE_ITEM_ENTITY, 'egcs_fc_fundingagreementbudgetlineitem')
      || mappingForPath(input.mappings, CLAIM_LINE_ITEM_ENTITY, 'egcs_fc_submittedlineitem')

    lineItems.push({
      budgetLineItemId: matchedBudgetLineItem ? String(matchedBudgetLineItem.id) : null,
      budgetLineItemMappingId: budgetLineItemMapping ? budgetLineItemMapping.id : '',
      submittedCostCategory,
      submittedCostSubsection,
      submittedLineItem,
      description: lineItemDescription(description, submittedCostCategory, submittedCostSubsection, submittedLineItem),
      amount,
      currency: normalizedText(currency || 'cad')
    })
  }

  return {
    lineItems,
    issues
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

const existingClaimBySubmissionUuid = async (
  rawDb: unknown,
  submissionUuid: string
) => {
  const db = asGcFormsIntegrationDb(rawDb)
  return await db
    .selectFrom('Funding_Case_Agreement_Claim')
    .select(['id'])
    .where('egcs_fc_gcformssubmissionuuid', '=', submissionUuid)
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
  submittedCostCategory: lineItem.submittedCostCategory,
  submittedCostSubsection: lineItem.submittedCostSubsection,
  submittedLineItem: lineItem.submittedLineItem,
  description: lineItem.description,
  amount: lineItem.amount,
  currency: lineItem.currency
})

/** Idempotently materializes a mapped submission into a claim, line items, and destination links. */
export const materializeGcFormsClaimSubmission = async (
  rawDb: unknown,
  input: ClaimMaterializationInput
): Promise<ClaimMaterializationResult> => {
  const unsupportedDestinationIssues = getUnsupportedGcFormsMaterializationIssues(input.mappings)
  if (unsupportedDestinationIssues.length > 0) {
    return {
      status: 'failed',
      lineItemIds: [],
      issues: unsupportedDestinationIssues
    }
  }

  const hasClaimMappings = hasMaterializationMapping(input.mappings, CLAIM_ENTITY)
  const hasLineItemMappings = hasMaterializationMapping(input.mappings, CLAIM_LINE_ITEM_ENTITY)
  const existing = await existingClaimLink(rawDb, input.submissionId)
  const existingBySubmissionUuid = await existingClaimBySubmissionUuid(rawDb, input.submissionUuid)

  if (existing) {
    return {
      status: 'already_materialized',
      claimId: String(existing.owner_id),
      lineItemIds: [],
      issues: []
    }
  }

  if (existingBySubmissionUuid) {
    return {
      status: 'already_materialized',
      claimId: String(existingBySubmissionUuid.id),
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

  const preparedLineItems = await prepareClaimLineItemInputs(rawDb, input, claimInput, values)
  if (preparedLineItems.issues.length > 0) {
    return {
      status: 'failed',
      lineItemIds: [],
      issues: preparedLineItems.issues
    }
  }

  const db = asGcFormsIntegrationDb(rawDb)
  const mappingIdsByKey = await fieldMappingIdsByKey(rawDb, input.integrationId)

  return await executeGcFormsTransaction(db, async trx => {
    const created = requireCreatedAgreementClaim(await input.createAgreementClaim({
      agreementId: claimInput.agreementId,
      streamId: input.streamId,
      fiscalYearId: claimInput.fiscalYearId,
      isFinalForYear: claimInput.isFinalForYear,
      periodStart: claimInput.periodStart,
      periodEnd: claimInput.periodEnd,
      receivedDate: claimInput.receivedDate,
      submissionUuid: input.submissionUuid,
      expectedDraftStatusId: input.submissionStatusId,
      lineItems: preparedLineItems.lineItems.map(lineItem => ({
        budgetLineItemId: lineItem.budgetLineItemId,
        submittedCostCategory: lineItem.submittedCostCategory,
        submittedCostSubsection: lineItem.submittedCostSubsection,
        submittedLineItem: lineItem.submittedLineItem,
        description: lineItem.description,
        amount: lineItem.amount,
        currency: lineItem.currency
      }))
    }))
    if (created.lineItemIds.length !== preparedLineItems.lineItems.length) {
      throw new Error('Host Claim creation returned an invalid line-item identity list.')
    }
    const claimId = created.claimId
    await trx
      .insertInto('extensions.gcs_gcforms_destination_links')
      .values({
        submission_id: input.submissionId,
        mapping_id: mappingIdsByKey.get(claimInput.agreementMappingId) ?? null,
        owner_type: getGcFormsDestinationOwnerType(CLAIM_ENTITY),
        owner_id: claimId,
        destination_entity: CLAIM_ENTITY,
        destination_path: CLAIM_ENTITY,
        value: gcFormsJsonbValue(claimLinkValue(claimId, claimInput))
      })
      .execute()

    for (const [index, preparedLineItem] of preparedLineItems.lineItems.entries()) {
      const lineItemId = created.lineItemIds[index]
      if (!lineItemId) {
        throw new Error('Host Claim creation returned an incomplete line-item identity list.')
      }
      await trx
        .insertInto('extensions.gcs_gcforms_destination_links')
        .values({
          submission_id: input.submissionId,
          mapping_id: mappingIdsByKey.get(preparedLineItem.budgetLineItemMappingId) ?? null,
          owner_type: getGcFormsDestinationOwnerType(CLAIM_LINE_ITEM_ENTITY),
          owner_id: lineItemId,
          destination_entity: CLAIM_LINE_ITEM_ENTITY,
          destination_path: CLAIM_LINE_ITEM_ENTITY,
          value: gcFormsJsonbValue(lineItemLinkValue(lineItemId, preparedLineItem))
        })
        .execute()
    }

    return {
      status: 'created',
      claimId,
      lineItemIds: created.lineItemIds,
      issues: []
    }
  })
}
