<script setup lang="ts">
import { StreamGcFormsIntegrationConfigMessages } from '../i18n/StreamGcFormsIntegrationConfig'

import { computed, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import {
  type GcsExtensionJsonConfig,
  type GcsResolvedExtension,
  type JsonValue
} from '@gcs-ssc/extensions'
import {
  ExtensionAlert,
  ExtensionButton,
  ExtensionEntityEditorWorkspace,
  ExtensionFormField,
  ExtensionIcon,
  ExtensionModal,
  ExtensionProgress,
  ExtensionResourceLayoutCard,
  ExtensionRouteTabs,
  ExtensionSaveButton,
  ExtensionSelect,
  ExtensionSelectMenu,
  ExtensionStatusBadge,
  useHostApi,
  useExtensionApi,
  useExtensionGroupedTableExpansion,
  useExtensionI18n,
  useExtensionToast,
  type GcsGroupedTableRow
} from '@gcs-ssc/extensions/ui'
import {
  normalizeGcFormsJsonValue,
  parseGcFormsStreamConfig,
  renderGcFormsDiagnostic,
  resolveGcFormsDiagnosticLocale,
  upsertGcFormsFieldMapping,
  type GcFormsCredentialSummary,
  type GcFormsFieldCatalogItem,
  type GcsGcFormsDiagnosticParams,
  type GcsGcFormsFieldMapping,
  type GcsGcFormsTransform,
  type GcsGcFormsStreamConfig
} from '../shared/gcforms'

const {
  extension,
  streamId,
  agencyId,
  streamEnabled = false,
  hostLayout = false
} = defineProps<{
  extension: GcsResolvedExtension
  streamId: string
  transferPaymentId?: string
  agencyId?: string
  streamEnabled?: boolean
  hostLayout?: boolean
}>()

const config = defineModel<GcsExtensionJsonConfig>({ required: true })
const { locale, t: tLocal } = useExtensionI18n(StreamGcFormsIntegrationConfigMessages)
const toast = useExtensionToast()
const api = useExtensionApi(extension.key)
const hostApi = useHostApi()

const isFrench = computed(() => locale.value === 'fr')

const withoutSyntheticFinalMapping = (value: GcsGcFormsStreamConfig): GcsGcFormsStreamConfig => ({
  ...value,
  mappings: value.mappings.filter(mapping =>
    mapping.id !== 'final-for-year'
    && mapping.sourceQuestionId !== '__gcforms_final_for_year'
  )
})

const localConfig: Ref<GcsGcFormsStreamConfig> = ref(withoutSyntheticFinalMapping(parseGcFormsStreamConfig(config.value)))
const fieldCatalog: Ref<GcFormsFieldCatalogItem[]> = ref([])
const credentials: Ref<GcFormsCredentialSummary[]> = ref([])
const isLoadingCredentials: Ref<boolean> = ref(false)
const isRefreshingTemplate: Ref<boolean> = ref(false)
const isDownloadingClaimTemplate: Ref<boolean> = ref(false)
const isSyncing: Ref<boolean> = ref(false)
const isSaving: Ref<boolean> = ref(false)
const isSyncModalOpen: Ref<boolean> = ref(false)
const isLoadingMaterializationFailures: Ref<boolean> = ref(false)
const resolvingSubmissionId: Ref<string | null> = ref(null)
const matchSearchTerm: Ref<string> = ref('')
const statusMessage: Ref<string> = ref('')
const failedMaterializations: Ref<GcFormsMaterializationFailureItem[]> = ref([])
const agreementOptions: Ref<GcFormsAgreementOption[]> = ref([])
const selectedMaterializationFailure: Ref<GcFormsMaterializationFailureItem | null> = ref(null)
const selectedMatchId: Ref<string> = ref('')
const isMatchModalOpen: Ref<boolean> = ref(false)
const selectedTab: Ref<string> = ref('fundingclaimreconcile')
const syncResult: Ref<GcFormsSyncResult | null> = ref(null)
const syncError: Ref<string> = ref('')
const templateShapeChanged: Ref<boolean> = ref(localConfig.value.templateShapeChanged)

interface GcFormsAgreementOption {
  id: string
  agreementNumber: string
  label: string
}

interface GcFormsMaterializationFailureItem {
  submissionId: string
  submissionName: string
  agreementNumber: string | null
  selectedAgreementId: string | null
  diagnostic: {
    code: string
    params: GcsGcFormsDiagnosticParams
    message?: string
  } | null
  issues: Array<{
    destinationPath: string
    code: string
    params: GcsGcFormsDiagnosticParams
    message?: string
  }>
  createdAt: string
}

interface GcFormsSyncResult {
  runId: string
  discovered: number
  imported: number
  skipped: number
  problems: number
}

interface ClaimMappingField {
  id: string
  labelKey: keyof typeof StreamGcFormsIntegrationConfigMessages.en
  destinationPath: string
  transform: GcsGcFormsTransform
  required: boolean
  repeat: boolean
  sourceQuestionId?: string
  defaultValue?: JsonValue
  onMissing?: 'block' | 'skip' | 'default'
  onInvalid?: 'block' | 'skip' | 'default'
}

type ClaimMappingFieldTableRow = ClaimMappingField & {
  isFormField: false
  mappingGroup: 'claim' | 'lineItem'
  mappingGroupLabel: string
}

type FormFieldTableRow = {
  id: string
  destinationPath: string
  required: boolean
  repeat: false
  sourceQuestionId: string
  fieldLabel: string
  fieldType: string
  isFormField: true
  mappingGroup: 'formField'
  mappingGroupLabel: string
}

type MappingFieldTableRow = ClaimMappingFieldTableRow | FormFieldTableRow

type GroupedMappingFieldRow = GcsGroupedTableRow<MappingFieldTableRow>

const buildHostConfig = (value: GcsGcFormsStreamConfig): GcsExtensionJsonConfig => ({
  credentialId: value.credentialId ?? null,
  templateShapeChanged: templateShapeChanged.value,
  mappings: normalizeGcFormsJsonValue(value.mappings)
})

const configsEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

watch(localConfig, value => {
  const nextConfig = buildHostConfig(value)
  if (!configsEqual(config.value, nextConfig)) {
    config.value = nextConfig
  }
}, { deep: true })

watch(config, value => {
  const nextLocalConfig = withoutSyntheticFinalMapping(parseGcFormsStreamConfig(value))
  if (!configsEqual(localConfig.value, nextLocalConfig)) {
    localConfig.value = nextLocalConfig
  }
  if (templateShapeChanged.value !== nextLocalConfig.templateShapeChanged) {
    templateShapeChanged.value = nextLocalConfig.templateShapeChanged
  }
})

watch(templateShapeChanged, value => {
  if (config.value.templateShapeChanged === value) {
    return
  }

  const nextConfig: GcsExtensionJsonConfig = {
    ...config.value,
    templateShapeChanged: value
  }
  if (!configsEqual(config.value, nextConfig)) {
    config.value = nextConfig
  }
})

const defaultScalarSourceQuestionIds = [
  'agreement_number',
  'fiscal_year',
  'claim_period_start_month',
  'claim_period_end_month',
  '__gcforms_created_at'
]

const defaultRepeatedSourceQuestionIds = [
  'submitted_cost_category',
  'submitted_cost_subsection',
  'submitted_line_item',
  'submitted_amount'
]

const NO_SOURCE_FIELD_VALUE = '__gcforms_no_source_field'

const sourceLabel = (sourceQuestionId: string): string =>
  sourceQuestionId === '__gcforms_created_at' ? tLocal('submissionCreatedAt') : sourceQuestionId

const sourceOption = (sourceQuestionId: string) => ({
  label: sourceLabel(sourceQuestionId),
  value: sourceQuestionId
})

/** Normalizes a template field catalog while discarding entries without a question identifier or type. */
const parseFieldCatalog = (value: unknown): GcFormsFieldCatalogItem[] => Array.isArray(value)
  ? value.flatMap((field): GcFormsFieldCatalogItem[] => {
      if (typeof field !== 'object' || field === null) {
        return []
      }

      const candidate = field as Partial<GcFormsFieldCatalogItem>
      if (typeof candidate.questionId !== 'string' || typeof candidate.type !== 'string') {
        return []
      }

      return [{
        id: typeof candidate.id === 'string' ? candidate.id : candidate.questionId,
        questionId: candidate.questionId,
        type: candidate.type,
        label_en: typeof candidate.label_en === 'string' ? candidate.label_en : candidate.questionId,
        label_fr: typeof candidate.label_fr === 'string' ? candidate.label_fr : candidate.questionId,
        required: candidate.required === true,
        tags: Array.isArray(candidate.tags)
          ? candidate.tags.filter((tag): tag is string => typeof tag === 'string')
          : []
      }]
    })
  : []

const uniqueSourceOptions = (sourceQuestionIds: string[]) => {
  const seen = new Set<string>()
  return sourceQuestionIds
    .filter(sourceQuestionId => sourceQuestionId.length > 0)
    .filter(sourceQuestionId => {
      if (seen.has(sourceQuestionId)) {
        return false
      }
      seen.add(sourceQuestionId)
      return true
    })
    .map(sourceOption)
}

const optionalScalarSourceOptions = computed(() => [
  { label: tLocal('noSourceField'), value: NO_SOURCE_FIELD_VALUE },
  ...uniqueSourceOptions([
    ...defaultScalarSourceQuestionIds,
    ...localConfig.value.mappings
      .filter(mapping => mapping.destinationEntity === 'claim')
      .map(mapping => mapping.sourceQuestionId),
    ...fieldCatalog.value
      .filter(field => field.type !== 'dynamicRow' && !field.tags.includes('line_item'))
      .map(field => field.questionId)
  ])
])

const scalarSourceOptions = computed(() => optionalScalarSourceOptions.value.filter(option => option.value))

const repeatedSourceOptions = computed(() => uniqueSourceOptions([
  ...defaultRepeatedSourceQuestionIds,
  ...localConfig.value.mappings
    .filter(mapping => mapping.destinationEntity === 'claim_line_item')
    .map(mapping => mapping.sourceQuestionId),
  ...fieldCatalog.value
    .filter(field => field.tags.includes('line_item'))
    .map(field => field.questionId)
]))

const hostEntityTypes = [
  'fundingclaimreconcile',
  'fundingcaseforecast',
  'fundingcaseintake'
] as const

const hostEntityTypeIcons: Record<typeof hostEntityTypes[number], string> = {
  fundingcaseintake: 'i-lucide-inbox',
  fundingclaimreconcile: 'i-lucide-receipt-text',
  fundingcaseforecast: 'i-lucide-chart-line'
}

const entityTabs = computed(() => [
  { key: 'gcforms.failed', label: tLocal('failedMaterializations'), value: 'failed-materializations', icon: 'i-lucide-triangle-alert' },
  ...hostEntityTypes.map(entity => ({
    key: `gcforms.${entity}`,
    label: tLocal(entity),
    value: entity,
    icon: hostEntityTypeIcons[entity]
  }))
])

const claimFields = computed<ClaimMappingField[]>(() => [
  {
    id: 'agreement-number',
    labelKey: 'claimAgreementNumber',
    sourceQuestionId: 'agreement_number',
    destinationPath: 'egcs_fc_fundingagreement',
    transform: 'string',
    required: true,
    repeat: false
  },
  {
    id: 'fiscal-year',
    labelKey: 'claimFiscalYear',
    sourceQuestionId: 'fiscal_year',
    destinationPath: 'egcs_fc_fiscalyear',
    transform: 'string',
    required: true,
    repeat: false
  },
  {
    id: 'period-start',
    labelKey: 'claimPeriodStart',
    sourceQuestionId: 'claim_period_start_month',
    destinationPath: 'egcs_fc_periodstart',
    transform: 'string',
    required: true,
    repeat: false
  },
  {
    id: 'period-end',
    labelKey: 'claimPeriodEnd',
    sourceQuestionId: 'claim_period_end_month',
    destinationPath: 'egcs_fc_periodend',
    transform: 'string',
    required: true,
    repeat: false
  },
  {
    id: 'received-date',
    labelKey: 'claimReceivedDate',
    sourceQuestionId: '__gcforms_created_at',
    destinationPath: 'egcs_fc_receiveddate',
    transform: 'date',
    required: true,
    repeat: false
  },
  {
    id: 'final-for-year',
    labelKey: 'claimFinalForYear',
    destinationPath: 'egcs_fc_isfinalforyear',
    transform: 'boolean',
    required: false,
    repeat: false,
    defaultValue: false,
    onMissing: 'default',
    onInvalid: 'default'
  }
])

const claimLineItemFields = computed<ClaimMappingField[]>(() => [
  {
    id: 'submitted-cost-category',
    labelKey: 'lineCostCategory',
    sourceQuestionId: 'submitted_cost_category',
    destinationPath: 'egcs_fc_submittedcostcategory',
    transform: 'string',
    required: true,
    repeat: true
  },
  {
    id: 'submitted-cost-subsection',
    labelKey: 'lineCostSubsection',
    sourceQuestionId: 'submitted_cost_subsection',
    destinationPath: 'egcs_fc_submittedcostsubsection',
    transform: 'string',
    required: true,
    repeat: true
  },
  {
    id: 'submitted-line-item',
    labelKey: 'lineItem',
    sourceQuestionId: 'submitted_line_item',
    destinationPath: 'egcs_fc_submittedlineitem',
    transform: 'string',
    required: true,
    repeat: true
  },
  {
    id: 'submitted-amount',
    labelKey: 'lineSubmittedAmount',
    sourceQuestionId: 'submitted_amount',
    destinationPath: 'egcs_fc_amount',
    transform: 'money',
    required: true,
    repeat: true
  }
])

const MAPPING_GROUP_COLUMN_ID = 'mappingGroup'
const mappingFieldPagination: Ref<{ pageIndex: number; pageSize: number }> = ref({
  pageIndex: 0,
  pageSize: 20
})
const mappingFieldSearch: Ref<string> = ref('')
const allMappingFieldRows = computed<MappingFieldTableRow[]>(() => [
  ...claimFields.value.map(field => ({
    ...field,
    isFormField: false as const,
    mappingGroup: 'claim' as const,
    mappingGroupLabel: tLocal('claimFields')
  })),
  ...claimLineItemFields.value.map(field => ({
    ...field,
    isFormField: false as const,
    mappingGroup: 'lineItem' as const,
    mappingGroupLabel: tLocal('lineItemFields')
  })),
  ...fieldCatalog.value.map(field => ({
    id: `form-field:${field.questionId}`,
    destinationPath: field.questionId,
    required: field.required,
    repeat: false as const,
    sourceQuestionId: field.questionId,
    fieldLabel: isFrench.value ? field.label_fr : field.label_en,
    fieldType: field.type,
    isFormField: true as const,
    mappingGroup: 'formField' as const,
    mappingGroupLabel: tLocal('template')
  }))
])
const mappingFieldRows = computed(() => {
  const search = mappingFieldSearch.value.trim().toLowerCase()
  if (!search) {
    return allMappingFieldRows.value
  }

  return allMappingFieldRows.value.filter(row =>
    getMappingFieldRowLabel(row).toLowerCase().includes(search)
    || row.destinationPath.toLowerCase().includes(search)
    || row.mappingGroupLabel.toLowerCase().includes(search)
    || (rowIsClaimMappingField(row) ? fieldSourceValue(row).toLowerCase().includes(search) : row.sourceQuestionId.toLowerCase().includes(search))
    || (rowIsFormField(row) ? row.fieldType.toLowerCase().includes(search) : false)
  )
})
const mappingFieldColumns = computed(() => [
  { id: MAPPING_GROUP_COLUMN_ID, accessorKey: MAPPING_GROUP_COLUMN_ID, header: tLocal('mappings') },
  { id: 'hostField', header: tLocal('hostField') },
  { id: 'requirement', header: tLocal('fieldRequirement') },
  { id: 'sourceField', header: tLocal('sourceField') }
])
const {
  expandedRows: mappingExpandedRows,
  grouping: mappingGrouping,
  columnVisibility: mappingColumnVisibility,
  groupingOptions: mappingGroupingOptions,
  isGroupRow: isMappingGroupRow,
  getGroupedRowCount: getMappingGroupedRowCount,
  canExpandGroupedRow: canExpandMappingGroupedRow,
  updateExpandedRows: updateMappingExpandedRows
} = useExtensionGroupedTableExpansion<MappingFieldTableRow>({
  rows: mappingFieldRows,
  groups: [
    {
      id: MAPPING_GROUP_COLUMN_ID,
      getValue: row => row.mappingGroup
    }
  ],
  defaultExpanded: true
})
const mappingExpandedOptions = {
  autoResetExpanded: false
}

const agreementSelectOptions = computed(() => agreementOptions.value.map(agreement => ({
  label: agreement.label,
  value: agreement.id
})))
const searchedAgreementSelectOptions = computed(() => {
  const search = matchSearchTerm.value.trim().toLowerCase()
  if (!search) {
    return agreementSelectOptions.value
  }

  return agreementSelectOptions.value.filter(agreement =>
    agreement.label.toLowerCase().includes(search)
    || agreement.value.toLowerCase().includes(search)
  )
})
const credentialOptions = computed(() => credentials.value.map(credential => ({
  label: `${isFrench.value ? credential.name_fr : credential.name_en} (${credential.formId}, ${credential.keyId})`,
  value: credential.id
})))
const selectedCredentialMissing = computed(() => !localConfig.value.credentialId)

const failedMaterializationPagination: Ref<{ pageIndex: number; pageSize: number }> = ref({
  pageIndex: 0,
  pageSize: 10
})
const failedMaterializationSearch: Ref<string> = ref('')
const failedMaterializationStatusFilter: Ref<string> = ref('all')
const failedMaterializationColumns = computed(() => [
  { id: 'submission', header: tLocal('submission') },
  { id: 'failedOn', header: tLocal('failedOn') },
  { id: 'sourceValue', header: tLocal('sourceValue') },
  { id: 'actions', header: tLocal('actions') }
])
const activeDiagnosticLocale = () => resolveGcFormsDiagnosticLocale(locale.value)
const issueMessage = (issue: GcFormsMaterializationFailureItem['issues'][number]): string =>
  renderGcFormsDiagnostic(issue, activeDiagnosticLocale())
const failureDiagnosticMessage = (submission: GcFormsMaterializationFailureItem): string =>
  submission.diagnostic
    ? renderGcFormsDiagnostic(submission.diagnostic, activeDiagnosticLocale())
    : ''
const filteredFailedMaterializations = computed(() => {
  const search = failedMaterializationSearch.value.trim().toLowerCase()
  if (!search) {
    return failedMaterializations.value
  }

  return failedMaterializations.value.filter(item =>
    item.submissionName.toLowerCase().includes(search)
    || failureDiagnosticMessage(item).toLowerCase().includes(search)
    || (item.agreementNumber ?? '').toLowerCase().includes(search)
    || item.issues.some(issue => issue.destinationPath.toLowerCase().includes(search) || issueMessage(issue).toLowerCase().includes(search))
  )
})
const visibleFailedMaterializations = computed(() => {
  const start = failedMaterializationPagination.value.pageIndex * failedMaterializationPagination.value.pageSize
  return filteredFailedMaterializations.value.slice(start, start + failedMaterializationPagination.value.pageSize)
})
const matchModalTitle = computed(() => selectedMaterializationFailure.value
  ? `${tLocal('matchSubmission')}: ${selectedMaterializationFailure.value.submissionName}`
  : tLocal('matchSubmission')
)
const selectedFailureHasAgreementMatcher = computed(() => selectedMaterializationFailure.value?.issues.some(issue =>
  issue.destinationPath === 'claim.egcs_fc_fundingagreement'
  || issue.destinationPath === 'egcs_fc_fundingagreement'
  || issue.code === 'agreement_not_found'
  || issue.code === 'agreement_override_unavailable'
) === true)

const firstFailureIssue = (submission: GcFormsMaterializationFailureItem) => submission.issues[0] ?? null
const firstFailureIssueMessage = (submission: GcFormsMaterializationFailureItem): string => {
  const issue = firstFailureIssue(submission)
  return issue ? issueMessage(issue) : ''
}

const openMatchModal = (submission: GcFormsMaterializationFailureItem) => {
  selectedMaterializationFailure.value = submission
  selectedMatchId.value = submission.selectedAgreementId ?? ''
  matchSearchTerm.value = ''
  isMatchModalOpen.value = true
}

/** Updates, creates, or removes the configured source mapping for a claim field. */
const upsertClaimMapping = (field: ClaimMappingField, sourceQuestionId: unknown) => {
  const rawValue = sourceQuestionId === null || sourceQuestionId === undefined ? '' : String(sourceQuestionId)
  const value = rawValue === NO_SOURCE_FIELD_VALUE ? '' : rawValue
  const existingIndex = localConfig.value.mappings.findIndex(mapping => mapping.id === field.id)
  if (!value && !field.sourceQuestionId) {
    if (existingIndex >= 0) {
      localConfig.value.mappings = localConfig.value.mappings.filter(mapping => mapping.id !== field.id)
    }
    return
  }

  const nextMapping: GcsGcFormsFieldMapping = {
    id: field.id,
    sourceQuestionId: value || field.sourceQuestionId || '',
    destinationEntity: 'claim_line_item',
    destinationPath: field.destinationPath,
    transform: field.transform,
    required: field.required,
    onMissing: field.onMissing ?? (field.required ? 'block' : 'skip'),
    onInvalid: field.onInvalid ?? 'block'
  }
  if (field.defaultValue !== undefined) {
    nextMapping.defaultValue = field.defaultValue
  }

  nextMapping.destinationEntity = field.repeat ? 'claim_line_item' : 'claim'
  localConfig.value.mappings = upsertGcFormsFieldMapping(localConfig.value.mappings, nextMapping)
}

const mappingForField = (field: ClaimMappingField) => localConfig.value.mappings.find(mapping => mapping.id === field.id)

const fieldSourceValue = (field: ClaimMappingField): string => mappingForField(field)?.sourceQuestionId ?? field.sourceQuestionId ?? ''

const fieldSelectValue = (field: ClaimMappingField): string =>
  fieldSourceValue(field) || NO_SOURCE_FIELD_VALUE

const sourceOptionsForField = (field: ClaimMappingField) => field.sourceQuestionId ? scalarSourceOptions.value : optionalScalarSourceOptions.value
const rowIsFormField = (row: MappingFieldTableRow): row is FormFieldTableRow => row.isFormField
const rowIsClaimMappingField = (row: MappingFieldTableRow): row is ClaimMappingFieldTableRow => !row.isFormField
const rowIsRepeatedClaimMappingField = (row: MappingFieldTableRow): row is ClaimMappingFieldTableRow =>
  rowIsClaimMappingField(row) && row.repeat
const getMappingFieldRowLabel = (row: MappingFieldTableRow): string =>
  rowIsFormField(row) ? row.fieldLabel : tLocal(row.labelKey)
const mappingRowSourceValue = (row: MappingFieldTableRow): string =>
  rowIsClaimMappingField(row) ? fieldSourceValue(row) : ''
const mappingRowSelectValue = (row: MappingFieldTableRow): string =>
  rowIsClaimMappingField(row) ? fieldSelectValue(row) : NO_SOURCE_FIELD_VALUE
const sourceOptionsForMappingRow = (row: MappingFieldTableRow) =>
  rowIsClaimMappingField(row) ? sourceOptionsForField(row) : optionalScalarSourceOptions.value
const upsertMappingRow = (row: MappingFieldTableRow, value: unknown) => {
  if (rowIsClaimMappingField(row)) {
    upsertClaimMapping(row, value)
  }
}

const errorDescription = (error: unknown): string => error instanceof Error ? error.message : String(error)

const postJson = async (path: string, body?: JsonValue | Record<string, unknown>): Promise<unknown> => {
  const requestOptions = { headers: { 'accept-language': activeDiagnosticLocale() } }
  return body === undefined
    ? await api.post(path, undefined, requestOptions)
    : await api.post(path, body, requestOptions)
}

const getJson = async (path: string): Promise<unknown> => {
  return await api.get(path, { headers: { 'accept-language': activeDiagnosticLocale() } })
}

const loadCredentials = async () => {
  if (!agencyId) {
    credentials.value = []
    return
  }

  try {
    isLoadingCredentials.value = true
    const response = await getJson(`/agencies/${agencyId}/credentials`) as { items?: GcFormsCredentialSummary[] }
    credentials.value = response.items ?? []
  } catch {
    credentials.value = []
  } finally {
    isLoadingCredentials.value = false
  }
}

/** Refreshes the stored template catalog through the selected credential and reports any failure. */
const refreshTemplate = async () => {
  if (selectedCredentialMissing.value) {
    statusMessage.value = tLocal('credentialRequired')
    return
  }

  try {
    isRefreshingTemplate.value = true
    statusMessage.value = tLocal('loading')
    const response = await postJson(`/streams/${streamId}/template`) as { fieldCatalog?: unknown }
    fieldCatalog.value = parseFieldCatalog(response.fieldCatalog)
    templateShapeChanged.value = false
    statusMessage.value = tLocal('success')
  } catch (error: unknown) {
    statusMessage.value = errorDescription(error)
    toast.add({
      title: tLocal('refreshTemplateFailed'),
      description: errorDescription(error),
      color: 'error'
    })
  } finally {
    isRefreshingTemplate.value = false
  }
}

/** Persists the current stream extension configuration with a bounded request timeout. */
const saveConfiguration = async () => {
  if (isSaving.value) {
    return
  }

  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), 15000)

  try {
    isSaving.value = true
    statusMessage.value = tLocal('loading')
    await hostApi.patch(`/api/extensions/streams/${streamId}`, {
      extensionKey: extension.key,
      enabled: streamEnabled,
      config: config.value
    }, {
      signal: controller.signal
    })

    statusMessage.value = tLocal('success')
    toast.add({
      title: tLocal('saved'),
      description: tLocal('savedDescription'),
      color: 'success'
    })
  } catch (error: unknown) {
    const description = error instanceof DOMException && error.name === 'AbortError'
      ? 'Save timed out.'
      : errorDescription(error)
    statusMessage.value = description
    toast.add({
      title: tLocal('saveFailed'),
      description,
      color: 'error'
    })
  } finally {
    globalThis.clearTimeout(timeout)
    isSaving.value = false
  }
}

const loadStoredTemplate = async () => {
  try {
    const response = await getJson(`/streams/${streamId}/template`) as {
      fieldCatalog?: GcFormsFieldCatalogItem[]
      templateShapeChanged?: boolean
    }
    fieldCatalog.value = parseFieldCatalog(response.fieldCatalog)
    templateShapeChanged.value = response.templateShapeChanged === true
  } catch (error: unknown) {
    fieldCatalog.value = []
    templateShapeChanged.value = false
    statusMessage.value = errorDescription(error)
  }
}

const downloadJsonFile = (fileName: string, value: unknown) => {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

const downloadClaimTemplate = async () => {
  if (isDownloadingClaimTemplate.value) {
    return
  }

  try {
    isDownloadingClaimTemplate.value = true
    const template = await getJson(`/streams/${streamId}/claim-template`)
    downloadJsonFile(`gcs-claim-form-stream-${streamId}.json`, template)
  } catch (error: unknown) {
    toast.add({
      title: tLocal('downloadClaimFormFailed'),
      description: errorDescription(error),
      color: 'error'
    })
  } finally {
    isDownloadingClaimTemplate.value = false
  }
}

/** Synchronizes configured GC Forms submissions and refreshes outstanding materialization failures. */
const syncSubmissions = async () => {
  if (selectedCredentialMissing.value) {
    syncError.value = tLocal('credentialRequired')
    statusMessage.value = tLocal('credentialRequired')
    return
  }

  try {
    isSyncing.value = true
    syncError.value = ''
    syncResult.value = null
    statusMessage.value = tLocal('loading')
    syncResult.value = await postJson(`/streams/${streamId}/sync`) as GcFormsSyncResult
    await refreshMaterializationFailures()
    statusMessage.value = tLocal('success')
  } catch (error: unknown) {
    syncError.value = errorDescription(error)
    try {
      await loadStoredTemplate()
    } catch {
      // Keep the original sync error visible in the modal.
    }
    statusMessage.value = errorDescription(error)
  } finally {
    isSyncing.value = false
  }
}

const openSyncModal = async () => {
  isSyncModalOpen.value = true
  await syncSubmissions()
}

const reviewFailedMaterializations = () => {
  selectedTab.value = 'failed-materializations'
  isSyncModalOpen.value = false
}

const refreshMaterializationFailures = async () => {
  try {
    isLoadingMaterializationFailures.value = true
    const response = await getJson(`/streams/${streamId}/materialization-failures`) as {
      items?: GcFormsMaterializationFailureItem[]
      agreements?: GcFormsAgreementOption[]
    }
    failedMaterializations.value = response.items ?? []
    agreementOptions.value = response.agreements ?? []
  } catch {
    failedMaterializations.value = []
    agreementOptions.value = []
  } finally {
    isLoadingMaterializationFailures.value = false
  }
}

/** Assigns the selected agreement to a failed submission and refreshes the failure queue. */
const resolveMaterializationFailure = async () => {
  const submission = selectedMaterializationFailure.value
  if (!submission || !selectedMatchId.value) {
    return
  }

  try {
    resolvingSubmissionId.value = submission.submissionId
    statusMessage.value = tLocal('loading')
    await postJson(`/streams/${streamId}/materialization-failures/${submission.submissionId}/agreement`, { agreementId: selectedMatchId.value })
    await refreshMaterializationFailures()
    isMatchModalOpen.value = false
    selectedMaterializationFailure.value = null
    selectedMatchId.value = ''
    statusMessage.value = tLocal('success')
  } catch (error: unknown) {
    statusMessage.value = errorDescription(error)
  } finally {
    resolvingSubmissionId.value = null
  }
}

onMounted(async () => {
  await Promise.allSettled([
    loadCredentials(),
    loadStoredTemplate(),
    refreshMaterializationFailures()
  ])
})
</script>

<template>
  <ExtensionEntityEditorWorkspace :content-test-id="hostLayout ? 'gcforms-config-page-content' : undefined">
    <template #sidebar>
      <ExtensionRouteTabs
        v-model="selectedTab"
        :items="entityTabs"
        orientation="vertical"
        :ui="{
          root: 'w-full',
          list: 'w-full flex-col items-stretch p-0',
          trigger: 'w-full justify-start'
        }" />
    </template>

    <section v-if="selectedTab === 'failed-materializations'" class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h3 class="text-base font-semibold text-highlighted">
          {{ tLocal('failedMaterializations') }}
        </h3>
        <ExtensionButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          class="cursor-default"
          :label="tLocal('refreshFailures')"
          :loading="isLoadingMaterializationFailures"
          @click="refreshMaterializationFailures" />
      </div>
      <ExtensionResourceLayoutCard
        v-model:search="failedMaterializationSearch"
        v-model:status-filter="failedMaterializationStatusFilter"
        v-model:pagination="failedMaterializationPagination"
        :data="visibleFailedMaterializations"
        :columns="failedMaterializationColumns"
        :total-records="filteredFailedMaterializations.length"
        :loading="isLoadingMaterializationFailures"
        :show-button="false"
        :show-column-toggle="false">
        <template #empty>
          <div class="p-4 text-sm text-muted">
            {{ tLocal('noFailedMaterializations') }}
          </div>
        </template>

        <template #submission-cell="{ row }">
          <div class="font-medium text-highlighted">
            {{ row.original.submissionName }}
          </div>
          <div v-if="failureDiagnosticMessage(row.original)" class="mt-1 text-xs text-muted">
            {{ failureDiagnosticMessage(row.original) }}
          </div>
        </template>

        <template #failedOn-cell="{ row }">
          <div class="font-mono text-xs text-muted">
            {{ firstFailureIssue(row.original)?.destinationPath ?? '-' }}
          </div>
          <div v-if="firstFailureIssue(row.original)" class="mt-1 text-xs text-muted">
            {{ firstFailureIssueMessage(row.original) }}
          </div>
        </template>

        <template #sourceValue-cell="{ row }">
          <span class="font-mono text-xs text-muted">
            {{ row.original.agreementNumber ?? '-' }}
          </span>
        </template>

        <template #actions-cell="{ row }">
          <ExtensionButton
            icon="i-lucide-link"
            color="primary"
            variant="ghost"
            size="sm"
            class="cursor-default"
            :aria-label="tLocal('match')"
            @click="openMatchModal(row.original)" />
        </template>
      </ExtensionResourceLayoutCard>
    </section>

    <section v-else-if="selectedTab === 'fundingclaimreconcile'" class="space-y-6">
      <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-end gap-2">
          <ExtensionButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            class="cursor-default"
            :label="tLocal('refreshTemplate')"
            :loading="isRefreshingTemplate"
            :disabled="selectedCredentialMissing"
            @click="refreshTemplate" />
          <ExtensionButton
            icon="i-lucide-file-json"
            color="neutral"
            variant="outline"
            class="cursor-default"
            :label="tLocal('downloadClaimForm')"
            :loading="isDownloadingClaimTemplate"
            @click="downloadClaimTemplate" />
          <ExtensionButton
            icon="i-lucide-download"
            color="neutral"
            variant="outline"
            class="cursor-default"
            :label="tLocal('sync')"
            :loading="isSyncing"
            :disabled="selectedCredentialMissing"
            @click="openSyncModal" />
          <ExtensionSaveButton
            type="button"
            :label="tLocal('save')"
            :loading="isSaving"
            :disabled="isSaving"
            @click="saveConfiguration" />
        </div>

        <div>
          <h3 class="text-base font-semibold text-highlighted">
            {{ tLocal('claimMappings') }}
          </h3>
          <p class="mt-1 text-sm text-muted">
            {{ tLocal('savedByHost') }}
          </p>
        </div>
      </div>

      <ExtensionFormField :label="tLocal('credential')" :help="tLocal('credentialRequired')" class="max-w-xl">
        <ExtensionSelectMenu
          v-model="localConfig.credentialId"
          :items="credentialOptions"
          value-key="value"
          label-key="label"
          searchable
          :loading="isLoadingCredentials"
          :placeholder="tLocal('credentialPlaceholder')" />
      </ExtensionFormField>

      <ExtensionAlert
        v-if="selectedCredentialMissing"
        color="warning"
        variant="soft"
        icon="i-lucide-key-round"
        :title="tLocal('credential')"
        :description="tLocal('credentialRequired')" />

      <ExtensionAlert
        v-if="templateShapeChanged"
        color="error"
        variant="soft"
        icon="i-lucide-triangle-alert"
        :title="tLocal('templateShapeChanged')"
        :description="tLocal('templateShapeChangedDescription')" />

      <ExtensionAlert
        v-if="fieldCatalog.length === 0"
        color="warning"
        variant="soft"
        icon="i-lucide-refresh-cw"
        :title="tLocal('template')"
        :description="tLocal('refreshBeforeMapping')" />

      <div class="space-y-4">
        <ExtensionResourceLayoutCard
          v-model:search="mappingFieldSearch"
          v-model:pagination="mappingFieldPagination"
          :data="mappingFieldRows"
          :columns="mappingFieldColumns"
          :grouping="mappingGrouping"
          :grouping-options="mappingGroupingOptions"
          :column-visibility="mappingColumnVisibility"
          :expanded="mappingExpandedRows"
          :expanded-options="mappingExpandedOptions"
          :total-records="mappingFieldRows.length"
          :show-button="false"
          :show-column-toggle="false"
          @update:expanded="updateMappingExpandedRows">
          <template #hostField-cell="{ row }">
            <div v-if="isMappingGroupRow(row as GroupedMappingFieldRow, MAPPING_GROUP_COLUMN_ID)" class="flex w-full items-center gap-3 py-1">
              <button
                v-if="canExpandMappingGroupedRow(row as GroupedMappingFieldRow)"
                type="button"
                class="group flex min-w-0 items-center gap-3 text-left"
                :aria-label="row.getIsExpanded?.() ? tLocal('collapse') : tLocal('expand')"
                @click="row.toggleExpanded?.()">
                <ExtensionIcon
                  :name="row.getIsExpanded?.() ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  class="size-4 text-zinc-400 transition-colors group-hover:text-primary" />
                <span class="text-sm font-semibold text-zinc-900 dark:text-white">
                  {{ row.original.mappingGroupLabel }}
                </span>
                <ExtensionStatusBadge variant="count" size="sm" :label="String(getMappingGroupedRowCount(row as GroupedMappingFieldRow))" />
              </button>
              <div v-else class="flex min-w-0 items-center gap-3">
                <span class="ml-7 text-sm font-semibold text-zinc-900 dark:text-white">
                  {{ row.original.mappingGroupLabel }}
                </span>
                <ExtensionStatusBadge variant="count" size="sm" :label="String(getMappingGroupedRowCount(row as GroupedMappingFieldRow))" />
              </div>
            </div>

            <div v-else class="flex min-w-0 max-w-full flex-col gap-1 pl-16">
              <div class="font-medium text-highlighted">
                {{ getMappingFieldRowLabel(row.original) }}
              </div>
              <div class="font-mono text-xs text-muted">
                {{ row.original.destinationPath }}
              </div>
            </div>
          </template>

          <template #requirement-cell="{ row }">
            <span v-if="isMappingGroupRow(row as GroupedMappingFieldRow, MAPPING_GROUP_COLUMN_ID)">&nbsp;</span>
            <span v-else-if="rowIsFormField(row.original)" class="text-muted">
              {{ row.original.fieldType }}
            </span>
            <span v-else class="text-muted">
              {{ row.original.required ? tLocal('required') : '-' }}
            </span>
          </template>

          <template #sourceField-cell="{ row }">
            <span v-if="isMappingGroupRow(row as GroupedMappingFieldRow, MAPPING_GROUP_COLUMN_ID)">&nbsp;</span>
            <span v-else-if="rowIsFormField(row.original)" class="font-mono text-xs text-muted">
              {{ row.original.sourceQuestionId }}
            </span>
            <ExtensionSelect
              v-else-if="rowIsRepeatedClaimMappingField(row.original)"
              :model-value="mappingRowSourceValue(row.original)"
              :aria-label="`${tLocal('sourceField')}: ${getMappingFieldRowLabel(row.original)}`"
              :items="repeatedSourceOptions"
              @update:model-value="(value: unknown) => upsertMappingRow(row.original, value)" />
            <ExtensionSelect
              v-else-if="rowIsClaimMappingField(row.original)"
              :model-value="mappingRowSelectValue(row.original)"
              :aria-label="`${tLocal('sourceField')}: ${getMappingFieldRowLabel(row.original)}`"
              :items="sourceOptionsForMappingRow(row.original)"
              @update:model-value="(value: unknown) => upsertMappingRow(row.original, value)" />
          </template>

          <template #footer-left>
            <span class="text-xs font-bold tracking-widest text-zinc-400 uppercase">
              {{ mappingFieldRows.length }} {{ tLocal('mappings') }}
            </span>
          </template>
        </ExtensionResourceLayoutCard>

      </div>
    </section>

    <ExtensionAlert
      v-else
      color="info"
      variant="soft"
      icon="i-lucide-construction"
      :title="tLocal('inProgress')"
      :description="tLocal('inProgressDescription')" />

    <ExtensionModal
      v-model:open="isMatchModalOpen"
      :title="matchModalTitle"
      :description="tLocal('matchSubmissionDescription')"
      :dismissible="resolvingSubmissionId === null">
      <template #body>
        <div v-if="selectedMaterializationFailure" class="space-y-4">
          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <div class="text-xs font-medium text-muted">
                {{ tLocal('failedOn') }}
              </div>
              <div class="mt-1 font-mono text-xs text-highlighted">
                {{ firstFailureIssue(selectedMaterializationFailure)?.destinationPath ?? '-' }}
              </div>
            </div>
            <div>
              <div class="text-xs font-medium text-muted">
                {{ tLocal('sourceValue') }}
              </div>
              <div class="mt-1 font-mono text-xs text-highlighted">
                {{ selectedMaterializationFailure.agreementNumber ?? '-' }}
              </div>
            </div>
          </div>

          <ExtensionFormField v-if="selectedFailureHasAgreementMatcher" :label="tLocal('possibleAgreement')" required>
            <ExtensionSelectMenu
              v-model:search-term="matchSearchTerm"
              v-model="selectedMatchId"
              :items="searchedAgreementSelectOptions"
              value-key="value"
              label-key="label"
              searchable
              :search-input="{ placeholder: tLocal('match') }"
              :placeholder="tLocal('selectedMatch')" />
          </ExtensionFormField>

          <ExtensionAlert
            v-else
            color="info"
            variant="soft"
            icon="i-lucide-construction"
            :title="tLocal('matchTarget')"
            :description="tLocal('matcherUnavailable')" />
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <ExtensionButton
            color="neutral"
            variant="ghost"
            class="cursor-default"
            :label="tLocal('close')"
            :disabled="resolvingSubmissionId !== null"
            @click="isMatchModalOpen = false" />
          <ExtensionButton
            v-if="selectedFailureHasAgreementMatcher"
            color="primary"
            variant="solid"
            icon="i-lucide-link"
            class="cursor-default"
            :label="tLocal('match')"
            :disabled="!selectedMatchId"
            :loading="resolvingSubmissionId !== null"
            @click="resolveMaterializationFailure" />
        </div>
      </template>
    </ExtensionModal>

    <ExtensionModal
      v-model:open="isSyncModalOpen"
      :title="tLocal('syncTitle')"
      :description="tLocal('syncDescription')"
      :dismissible="!isSyncing">
      <template #body>
        <div class="space-y-4">
          <div v-if="isSyncing" class="space-y-3">
            <div class="flex items-center gap-3 text-sm text-muted">
              <ExtensionIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
              <span>{{ tLocal('syncInProgress') }}</span>
            </div>
            <ExtensionProgress animation="carousel" />
          </div>

          <ExtensionAlert
            v-else-if="syncError"
            color="error"
            variant="soft"
            icon="i-lucide-circle-alert"
            :title="tLocal('syncFailed')"
            :description="syncError" />

          <div v-else-if="syncResult" class="space-y-4">
            <ExtensionAlert
              color="success"
              variant="soft"
              icon="i-lucide-circle-check"
              :title="tLocal('syncComplete')"
              :description="`${syncResult.imported} ${tLocal('imported').toLowerCase()}, ${syncResult.skipped} ${tLocal('skipped').toLowerCase()}, ${syncResult.problems} ${tLocal('problems').toLowerCase()}`" />

            <div class="grid gap-3 sm:grid-cols-4">
              <div class="border-y border-default py-3">
                <div class="text-xs text-muted">
                  {{ tLocal('discovered') }}
                </div>
                <div class="mt-1 text-2xl font-semibold text-highlighted">
                  {{ syncResult.discovered }}
                </div>
              </div>
              <div class="border-y border-default py-3">
                <div class="text-xs text-muted">
                  {{ tLocal('imported') }}
                </div>
                <div class="mt-1 text-2xl font-semibold text-highlighted">
                  {{ syncResult.imported }}
                </div>
              </div>
              <div class="border-y border-default py-3">
                <div class="text-xs text-muted">
                  {{ tLocal('skipped') }}
                </div>
                <div class="mt-1 text-2xl font-semibold text-highlighted">
                  {{ syncResult.skipped }}
                </div>
              </div>
              <div class="border-y border-default py-3">
                <div class="text-xs text-muted">
                  {{ tLocal('problems') }}
                </div>
                <div class="mt-1 text-2xl font-semibold text-highlighted">
                  {{ syncResult.problems }}
                </div>
              </div>
            </div>

            <ExtensionAlert
              v-if="syncResult.problems > 0"
              color="warning"
              variant="soft"
              icon="i-lucide-triangle-alert"
              :title="tLocal('failedMaterializations')"
              :description="tLocal('failedSyncReviewDescription')" />
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <ExtensionButton
            color="neutral"
            variant="ghost"
            class="cursor-default"
            :label="tLocal('close')"
            :disabled="isSyncing"
            @click="isSyncModalOpen = false" />
          <ExtensionButton
            v-if="syncResult && syncResult.problems > 0"
            color="primary"
            variant="solid"
            icon="i-lucide-triangle-alert"
            class="cursor-default"
            :label="tLocal('reviewFailedMaterializations')"
            @click="reviewFailedMaterializations" />
        </div>
      </template>
    </ExtensionModal>
  </ExtensionEntityEditorWorkspace>
</template>
