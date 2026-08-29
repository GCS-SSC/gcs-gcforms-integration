import { z } from 'zod'
import type { GcsExtensionJsonConfig, JsonValue } from '@gcs-ssc/extensions'

export const GCFORMS_EXTENSION_KEY = 'gcs-gcforms-integration'

export const DEFAULT_GCFORMS_API_URL = 'https://api.forms-formulaires.alpha.canada.ca/v1'
export const DEFAULT_GCFORMS_IDP_URL = 'https://auth.forms-formulaires.alpha.canada.ca'
export const DEFAULT_GCFORMS_PROJECT_IDENTIFIER = '284778202772022819'
const GCFORMS_CLAIM_LINE_ITEMS_QUESTION_ID = 'submitted_line_items'
const GCFORMS_CLAIM_LINE_ITEM_QUESTION_IDS = [
  'submitted_cost_category',
  'submitted_cost_subsection',
  'submitted_line_item',
  'submitted_amount'
] as const
const GCFORMS_CLAIM_REQUIRED_QUESTION_IDS = [
  'agreement_number',
  'fiscal_year',
  'claim_period_start_month',
  'claim_period_end_month',
  GCFORMS_CLAIM_LINE_ITEMS_QUESTION_ID,
  ...GCFORMS_CLAIM_LINE_ITEM_QUESTION_IDS
] as const

const GcFormsPrivateApiKeySchema = z.object({
  keyId: z.string().min(1),
  key: z.string().min(1),
  userId: z.string().min(1),
  formId: z.string().min(1)
})

export type GcFormsPrivateApiKey = z.infer<typeof GcFormsPrivateApiKeySchema>

export const GcFormsCredentialSecretSchema = z.object({
  key: z.string().min(1)
})

export const GcFormsCredentialCreateSchema = z.object({
  name_en: z.string().min(1).max(200),
  name_fr: z.string().min(1).max(200),
  keyId: z.string().min(1).max(200),
  userId: z.string().min(1).max(200),
  formId: z.string().min(1).max(80),
  key: z.string().min(1)
})

const GcFormsCredentialPatchBaseSchema = z.object({
  name_en: z.string().min(1).max(200).optional(),
  name_fr: z.string().min(1).max(200).optional(),
  keyId: z.string().min(1).max(200).optional(),
  userId: z.string().min(1).max(200).optional(),
  formId: z.string().min(1).max(80).optional(),
  key: z.string().min(1).optional()
})

export const GcFormsCredentialPatchSchema = GcFormsCredentialPatchBaseSchema.superRefine((value, context) => {
  if (Object.keys(value).length > 0) {
    return
  }

  context.addIssue({
    code: 'custom',
    path: [],
    message: 'At least one credential field is required.'
  })
})

export type GcFormsCredentialPatch = z.infer<typeof GcFormsCredentialPatchSchema>

export interface GcFormsCredentialSummary {
  id: string
  name_en: string
  name_fr: string
  keyId: string
  userId: string
  formId: string
  updatedAt: string | null
}

export const GcFormsNewSubmissionSchema = z.object({
  name: z.string(),
  createdAt: z.coerce.number()
})

export type GcFormsNewSubmission = z.infer<typeof GcFormsNewSubmissionSchema>

export const GcFormsEncryptedSubmissionSchema = z.object({
  encryptedKey: z.string(),
  encryptedNonce: z.string(),
  encryptedAuthTag: z.string(),
  encryptedResponses: z.string()
})

export type GcFormsEncryptedSubmission = z.infer<typeof GcFormsEncryptedSubmissionSchema>

const GcFormsAttachmentSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  downloadLink: z.string(),
  isPotentiallyMalicious: z.boolean(),
  md5: z.string().optional()
})

export const GcFormsDecryptedSubmissionSchema = z.object({
  createdAt: z.coerce.number(),
  status: z.string(),
  confirmationCode: z.string(),
  answers: z.string(),
  checksum: z.string(),
  attachments: z.array(GcFormsAttachmentSchema).optional()
})

export type GcFormsDecryptedSubmission = z.infer<typeof GcFormsDecryptedSubmissionSchema>

export interface GcFormsTemplateElement {
  id: string | number
  type: string
  properties?: Record<string, unknown>
  elements?: GcFormsTemplateElement[]
}

export const GcFormsTemplateElementSchema: z.ZodType<GcFormsTemplateElement> = z.lazy(() => z.object({
  id: z.union([z.string(), z.number()]),
  type: z.string(),
  properties: z.record(z.string(), z.unknown()).optional(),
  elements: z.array(GcFormsTemplateElementSchema).optional()
}))

export const GcFormsFormTemplateSchema = z.object({
  layout: z.array(z.union([z.string(), z.number()])).optional(),
  titleEn: z.string().optional(),
  titleFr: z.string().optional(),
  elements: z.array(GcFormsTemplateElementSchema).default([]),
  confirmation: z.record(z.string(), z.unknown()).optional(),
  introduction: z.record(z.string(), z.unknown()).optional(),
  privacyPolicy: z.record(z.string(), z.unknown()).optional()
}).passthrough()

export type GcFormsFormTemplate = z.infer<typeof GcFormsFormTemplateSchema>

export interface GcFormsFieldCatalogItem {
  id: string
  questionId: string
  type: string
  label_en: string
  label_fr: string
  tags: string[]
  required: boolean
}

export interface GcFormsTemplateShapeElement {
  id: string
  questionId: string
  type: string
  required: boolean
  tags: string[]
  choices: JsonValue[]
  children: GcFormsTemplateShapeElement[]
}

const GcsDestinationEntitySchema = z.enum([
  'agreement',
  'proponent',
  'claim',
  'claim_line_item',
  'monitor',
  'source_record'
])

export type GcsDestinationEntity = z.infer<typeof GcsDestinationEntitySchema>

const GcsGcFormsTransformSchema = z.enum([
  'string',
  'number',
  'money',
  'date',
  'boolean',
  'enum',
  'bilingual_text',
  'attachment',
  'json'
])

export type GcsGcFormsTransform = z.infer<typeof GcsGcFormsTransformSchema>

const GcsGcFormsFailureModeSchema = z.enum(['block', 'skip', 'default'])

const OptionalStringSchema = z.preprocess(
  value => typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined,
  z.string().optional()
)

const MAX_POSTGRES_BIGINT = '9223372036854775807'
const OptionalBigintIdSchema = z.preprocess(
  value => typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined,
  z.string().regex(/^[1-9]\d*$/).refine(value => value.length < MAX_POSTGRES_BIGINT.length
    || (value.length === MAX_POSTGRES_BIGINT.length && value <= MAX_POSTGRES_BIGINT)).optional()
)

const isPrivateGcFormsHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '::' || normalized === '::1') {
    return true
  }
  if (normalized.includes(':')) {
    return normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('::ffff:')
  }
  const octets = normalized.split('.').map(Number)
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false
  }
  const [first = 0, second = 0] = octets
  return first === 0 || first === 10 || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224
}

export const GcFormsRemoteBaseUrlSchema = z.string().trim().url().superRefine((value, ctx) => {
  const url = new URL(value)
  if (url.protocol !== 'https:') {
    ctx.addIssue({ code: 'custom', message: 'GC Forms endpoints must use HTTPS.' })
  }
  if (url.username || url.password || url.search || url.hash) {
    ctx.addIssue({ code: 'custom', message: 'GC Forms endpoints cannot contain credentials, a query, or a fragment.' })
  }
  if (isPrivateGcFormsHostname(url.hostname)) {
    ctx.addIssue({ code: 'custom', message: 'GC Forms endpoints cannot target local or private network addresses.' })
  }
})

const OptionalRemoteBaseUrlSchema = z.preprocess(
  value => typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined,
  GcFormsRemoteBaseUrlSchema.optional()
)

const GcsGcFormsFieldMappingSchema = z.object({
  id: z.string().min(1),
  sourceQuestionId: z.string().min(1),
  destinationEntity: GcsDestinationEntitySchema,
  destinationPath: z.string().min(1),
  transform: GcsGcFormsTransformSchema,
  required: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  onMissing: GcsGcFormsFailureModeSchema.default('block'),
  onInvalid: GcsGcFormsFailureModeSchema.default('block')
})

export type GcsGcFormsFieldMapping = z.infer<typeof GcsGcFormsFieldMappingSchema>

const GcsGcFormsAgencyConfigSchema = z.object({
  apiUrl: OptionalRemoteBaseUrlSchema,
  identityProviderUrl: OptionalRemoteBaseUrlSchema,
  confirmSubmissions: z.boolean().default(false),
  submissionStatusId: OptionalBigintIdSchema
})

export type GcsGcFormsAgencyConfig = z.infer<typeof GcsGcFormsAgencyConfigSchema>

const GcsGcFormsStreamConfigSchema = z.object({
  credentialId: OptionalStringSchema,
  apiUrl: OptionalRemoteBaseUrlSchema,
  identityProviderUrl: OptionalRemoteBaseUrlSchema,
  projectIdentifier: OptionalStringSchema,
  contactEmail: OptionalStringSchema,
  preferredLanguage: z.enum(['en', 'fr']).default('en'),
  confirmSubmissions: z.boolean().default(false),
  submissionStatusId: OptionalBigintIdSchema,
  templateShapeChanged: z.boolean().default(false),
  mappings: z.array(GcsGcFormsFieldMappingSchema).default([])
})

export type GcsGcFormsStreamConfig = z.infer<typeof GcsGcFormsStreamConfigSchema>

export interface GcsGcFormsMappedValue {
  mappingId: string
  sourceQuestionId: string
  destinationEntity: GcsDestinationEntity
  destinationPath: string
  value: JsonValue
}

export const GCFORMS_DIAGNOSTIC_CODES = [
  'missing_required_value',
  'invalid_value',
  'unsupported_destination',
  'claim_required_value_missing',
  'claim_values_invalid',
  'claim_period_invalid',
  'agreement_not_found',
  'agreement_override_unavailable',
  'claim_fiscal_year_invalid',
  'claim_line_item_required_value_missing',
  'claim_line_item_values_invalid',
  'submission_processing_failed',
  'submission_status_invalid'
] as const

export type GcsGcFormsDiagnosticCode = typeof GCFORMS_DIAGNOSTIC_CODES[number]

export type GcsGcFormsMappingDiagnosticCode = Exclude<
  GcsGcFormsDiagnosticCode,
  'submission_processing_failed' | 'submission_status_invalid'
>

export type GcsGcFormsDiagnosticParam = string | number | boolean | null
export type GcsGcFormsDiagnosticParams = Record<string, GcsGcFormsDiagnosticParam>
export type GcsGcFormsDiagnosticLocale = 'en' | 'fr'

export interface GcsGcFormsStoredDiagnostic {
  code: string
  params: GcsGcFormsDiagnosticParams
}

export interface GcsGcFormsMappingIssue {
  mappingId: string
  sourceQuestionId: string
  destinationPath: string
  code: GcsGcFormsMappingDiagnosticCode
  params: GcsGcFormsDiagnosticParams
}

export interface GcsGcFormsStoredMappingIssue extends Omit<GcsGcFormsMappingIssue, 'code'> {
  code: string
}

export interface GcsGcFormsRenderedMappingIssue extends GcsGcFormsStoredMappingIssue {
  message: string
}

const GcsGcFormsDiagnosticParamSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null()
])

export const GcsGcFormsDiagnosticParamsSchema = z.record(
  z.string(),
  GcsGcFormsDiagnosticParamSchema
)

export const GcsGcFormsStoredMappingIssueSchema = z.object({
  mappingId: z.string(),
  sourceQuestionId: z.string(),
  destinationPath: z.string(),
  code: z.string().min(1),
  params: GcsGcFormsDiagnosticParamsSchema
}).strict()

const UNKNOWN_DIAGNOSTIC_MESSAGES = {
  en: 'GC Forms could not complete this mapping.',
  fr: 'GC Forms n’a pas pu terminer cette correspondance.'
} as const

export const UNKNOWN_GCFORMS_DIAGNOSTIC_CODE = 'unknown_diagnostic'

export const GCFORMS_DIAGNOSTIC_MESSAGES: Record<
  GcsGcFormsDiagnosticLocale,
  Record<GcsGcFormsDiagnosticCode, string>
> = {
  en: {
    missing_required_value: 'A required GC Forms value is missing for {destinationPath}.',
    invalid_value: 'The GC Forms value for {destinationPath} cannot be transformed.',
    unsupported_destination: 'The configured destination {destinationEntity} is not supported for claim materialization.',
    claim_required_value_missing: 'A required claim value is missing for {destinationPath}.',
    claim_values_invalid: 'Claim values could not be converted for {destinationPath}.',
    claim_period_invalid: 'The claim period at {destinationPath} must be within one fiscal year.',
    agreement_not_found: 'The agreement for {destinationPath} could not be found in this transfer payment stream.',
    agreement_override_unavailable: 'The selected agreement for {destinationPath} is no longer available in this transfer payment stream.',
    claim_fiscal_year_invalid: 'The claim fiscal year for {destinationPath} is not valid for the resolved agreement.',
    claim_line_item_required_value_missing: 'A required claim line item value is missing for {destinationPath} in row {row}.',
    claim_line_item_values_invalid: 'Claim line item values could not be converted for {destinationPath} in row {row}.',
    submission_processing_failed: 'GC Forms could not process this submission.',
    submission_status_invalid: 'The configured GC Forms submission status is invalid ({statusCode}).'
  },
  fr: {
    missing_required_value: 'Une valeur GC Forms obligatoire est manquante pour {destinationPath}.',
    invalid_value: 'La valeur GC Forms pour {destinationPath} ne peut pas être transformée.',
    unsupported_destination: 'La destination configurée {destinationEntity} n’est pas prise en charge pour la matérialisation des réclamations.',
    claim_required_value_missing: 'Une valeur de réclamation obligatoire est manquante pour {destinationPath}.',
    claim_values_invalid: 'Les valeurs de réclamation n’ont pas pu être converties pour {destinationPath}.',
    claim_period_invalid: 'La période de réclamation à {destinationPath} doit se situer dans un seul exercice financier.',
    agreement_not_found: 'L’entente pour {destinationPath} est introuvable dans ce volet de paiements de transfert.',
    agreement_override_unavailable: 'L’entente sélectionnée pour {destinationPath} n’est plus disponible dans ce volet de paiements de transfert.',
    claim_fiscal_year_invalid: 'L’exercice financier de la réclamation pour {destinationPath} n’est pas valide pour l’entente résolue.',
    claim_line_item_required_value_missing: 'Une valeur obligatoire de ligne de réclamation est manquante pour {destinationPath} à la ligne {row}.',
    claim_line_item_values_invalid: 'Les valeurs de la ligne de réclamation n’ont pas pu être converties pour {destinationPath} à la ligne {row}.',
    submission_processing_failed: 'GC Forms n’a pas pu traiter cette soumission.',
    submission_status_invalid: 'Le statut configuré pour les soumissions GC Forms n’est pas valide ({statusCode}).'
  }
}

const diagnosticPlaceholders = (template: string): string[] => [
  ...template.matchAll(/\{([^{}]+)\}/g)
].map(match => match[1] as string)

const isKnownGcFormsDiagnosticCode = (code: string): code is GcsGcFormsDiagnosticCode =>
  GCFORMS_DIAGNOSTIC_CODES.some(candidate => candidate === code)

/** Removes unknown codes, extra params, and invalid placeholder values before a diagnostic crosses a boundary. */
export const sanitizeGcFormsDiagnostic = (
  diagnostic: GcsGcFormsStoredDiagnostic
): GcsGcFormsStoredDiagnostic => {
  if (!isKnownGcFormsDiagnosticCode(diagnostic.code)) {
    return { code: UNKNOWN_GCFORMS_DIAGNOSTIC_CODE, params: {} }
  }

  const parsedParams = GcsGcFormsDiagnosticParamsSchema.safeParse(diagnostic.params)
  if (!parsedParams.success) {
    return { code: UNKNOWN_GCFORMS_DIAGNOSTIC_CODE, params: {} }
  }

  const placeholders = diagnosticPlaceholders(GCFORMS_DIAGNOSTIC_MESSAGES.en[diagnostic.code])
  if (placeholders.some(placeholder => !Object.hasOwn(parsedParams.data, placeholder))) {
    return { code: UNKNOWN_GCFORMS_DIAGNOSTIC_CODE, params: {} }
  }

  return {
    code: diagnostic.code,
    params: Object.fromEntries(placeholders.map(placeholder => [
      placeholder,
      parsedParams.data[placeholder] as GcsGcFormsDiagnosticParam
    ]))
  }
}

/** Resolves the request or interface locale to the extension's supported locale set. */
export const resolveGcFormsDiagnosticLocale = (
  locale: string | undefined
): GcsGcFormsDiagnosticLocale => locale?.toLowerCase().startsWith('fr') ? 'fr' : 'en'

/** Renders a stable diagnostic without exposing unknown codes, params, or stored prose. */
export const renderGcFormsDiagnostic = (
  diagnostic: GcsGcFormsStoredDiagnostic,
  locale: GcsGcFormsDiagnosticLocale
): string => {
  const sanitized = sanitizeGcFormsDiagnostic(diagnostic)
  if (!isKnownGcFormsDiagnosticCode(sanitized.code)) {
    return UNKNOWN_DIAGNOSTIC_MESSAGES[locale]
  }

  const template = GCFORMS_DIAGNOSTIC_MESSAGES[locale][sanitized.code]
  const placeholders = diagnosticPlaceholders(template)

  return placeholders.reduce(
    (message, placeholder) => message.replaceAll(
      `{${placeholder}}`,
      String(sanitized.params[placeholder])
    ),
    template
  )
}

/** Parses persisted message-free issues while accepting unknown future codes for safe rendering. */
export const parseGcFormsStoredMappingIssues = (
  value: unknown
): GcsGcFormsStoredMappingIssue[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap(item => {
    const parsed = GcsGcFormsStoredMappingIssueSchema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

/** Adds active-locale display text to one persisted message-free mapping issue. */
export const renderGcFormsMappingIssue = (
  issue: GcsGcFormsStoredMappingIssue,
  locale: GcsGcFormsDiagnosticLocale
): GcsGcFormsRenderedMappingIssue => {
  const diagnostic = sanitizeGcFormsDiagnostic(issue)
  return {
    mappingId: issue.mappingId,
    sourceQuestionId: issue.sourceQuestionId,
    destinationPath: issue.destinationPath,
    ...diagnostic,
    message: renderGcFormsDiagnostic(diagnostic, locale)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isGcFormsTemplateElement = (value: unknown): value is GcFormsTemplateElement =>
  GcFormsTemplateElementSchema.safeParse(value).success

const stringProperty = (source: Record<string, unknown> | undefined, keys: string[]): string => {
  if (!source) {
    return ''
  }

  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return ''
}

const tagsProperty = (properties: Record<string, unknown> | undefined): string[] => {
  const rawTags = properties?.tags ?? properties?.apiTags ?? properties?.additionalTags
  if (!Array.isArray(rawTags)) {
    return []
  }

  return rawTags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
}

const childElements = (element: GcFormsTemplateElement): GcFormsTemplateElement[] => {
  const properties = element.properties
  const subElements = properties?.subElements
  if (Array.isArray(element.elements)) {
    return element.elements
  }

  if (Array.isArray(subElements)) {
    return subElements.filter(isGcFormsTemplateElement)
  }

  return []
}

/** Projects an unknown value into a deterministic JSON-compatible representation. */
export const normalizeGcFormsJsonValue = (value: unknown): JsonValue => {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeGcFormsJsonValue(item))
  }

  if (isRecord(value)) {
    const entries: Array<[string, JsonValue]> = Object.keys(value)
      .sort()
      .map(key => [key, normalizeGcFormsJsonValue(value[key])])
    return Object.fromEntries(entries)
  }

  return String(value)
}

const choicesProperty = (properties: Record<string, unknown> | undefined): JsonValue[] => {
  const rawChoices = properties?.choices
  if (!Array.isArray(rawChoices)) {
    return []
  }

  return rawChoices.map(choice => normalizeGcFormsJsonValue(choice))
}

const stableStringify = (value: unknown): string => JSON.stringify(normalizeGcFormsJsonValue(value))

/** Flattens a GC Forms template into a normalized catalog of source fields. */
export const normalizeGcFormsTemplate = (template: unknown): GcFormsFieldCatalogItem[] => {
  const parsed = GcFormsFormTemplateSchema.parse(template)
  const fields: GcFormsFieldCatalogItem[] = []

  /** Adds an element and all nested elements to the normalized field catalog. */
  const visit = (element: GcFormsTemplateElement) => {
    const properties = element.properties
    const id = String(element.id)
    const questionId = stringProperty(properties, ['questionId', 'apiQuestionId', 'apiId']) || id
    const labelEn = stringProperty(properties, ['titleEn', 'labelEn', 'nameEn']) || questionId
    const labelFr = stringProperty(properties, ['titleFr', 'labelFr', 'nameFr']) || labelEn
    const validation = isRecord(properties?.validation) ? properties.validation : {}

    fields.push({
      id,
      questionId,
      type: element.type,
      label_en: labelEn,
      label_fr: labelFr,
      tags: tagsProperty(properties),
      required: validation.required === true
    })

    for (const child of childElements(element)) {
      visit(child)
    }
  }

  for (const element of parsed.elements) {
    visit(element)
  }

  return fields
}

/** Reduces a GC Forms template to the structural attributes that affect mapping compatibility. */
const normalizeGcFormsTemplateShape = (template: unknown): GcFormsTemplateShapeElement[] => {
  const parsed = GcFormsFormTemplateSchema.parse(template)

  const visit = (element: GcFormsTemplateElement): GcFormsTemplateShapeElement => {
    const properties = element.properties
    const id = String(element.id)
    const questionId = stringProperty(properties, ['questionId', 'apiQuestionId', 'apiId']) || id
    const validation = isRecord(properties?.validation) ? properties.validation : {}

    return {
      id,
      questionId,
      type: element.type,
      required: validation.required === true,
      tags: tagsProperty(properties).sort(),
      choices: choicesProperty(properties),
      children: childElements(element).map(child => visit(child))
    }
  }

  return parsed.elements.map(element => visit(element))
}

/** Compares two templates by their deterministic mapping-relevant shapes. */
export const gcFormsTemplateShapesEqual = (left: unknown, right: unknown): boolean =>
  stableStringify(normalizeGcFormsTemplateShape(left)) === stableStringify(normalizeGcFormsTemplateShape(right))

/** Returns required claim question identifiers that are absent from a template. */
export const getMissingGcFormsClaimQuestionIds = (template: unknown): string[] => {
  const found = new Set<string>()
  const visit = (elements: GcFormsTemplateShapeElement[]) => {
    for (const element of elements) {
      found.add(element.questionId)
      visit(element.children)
    }
  }

  visit(normalizeGcFormsTemplateShape(template))

  return GCFORMS_CLAIM_REQUIRED_QUESTION_IDS.filter(questionId => !found.has(questionId))
}

/** Parses a stream configuration and applies the GC Forms schema defaults. */
export const parseGcFormsStreamConfig = (config: GcsExtensionJsonConfig | unknown): GcsGcFormsStreamConfig =>
  GcsGcFormsStreamConfigSchema.parse(config ?? {})

/** Parses an agency configuration and applies the GC Forms schema defaults. */
export const parseGcFormsAgencyConfig = (config: GcsExtensionJsonConfig | unknown): GcsGcFormsAgencyConfig =>
  GcsGcFormsAgencyConfigSchema.parse(config ?? {})

/** Returns mappings with the matching entry replaced or the new entry appended. */
export const upsertGcFormsFieldMapping = (
  mappings: GcsGcFormsFieldMapping[],
  nextMapping: GcsGcFormsFieldMapping
): GcsGcFormsFieldMapping[] => {
  const existingIndex = mappings.findIndex(mapping => mapping.id === nextMapping.id)
  if (existingIndex < 0) {
    return [...mappings, nextMapping]
  }

  return mappings.map((mapping, index) => index === existingIndex ? nextMapping : mapping)
}

/** Adds stable question-id aliases to submission answers, including nested dynamic-row values. */
export const normalizeGcFormsAnswers = (
  answers: string | Record<string, unknown>,
  template?: unknown
): Record<string, unknown> => {
  const rawAnswers = (() => {
    if (typeof answers !== 'string') {
      return answers
    }

    const parsed = JSON.parse(answers)
    return isRecord(parsed) ? parsed : {}
  })()

  if (!template) {
    return rawAnswers
  }

  const parsedTemplate = GcFormsFormTemplateSchema.parse(template)
  const aliases = new Map<string, string>()
  const dynamicRowAliases = new Map<string, Map<string, string>>()
  /** Collects element-id aliases and nested dynamic-row aliases from the template. */
  const visit = (element: GcFormsTemplateElement) => {
    const id = String(element.id)
    const questionId = stringProperty(element.properties, ['questionId', 'apiQuestionId', 'apiId'])
    if (questionId) {
      aliases.set(id, questionId)
    }
    const children = childElements(element)
    if (questionId && children.length > 0) {
      const childAliases = new Map<string, string>()
      children.forEach((child, index) => {
        const childQuestionId = stringProperty(child.properties, ['questionId', 'apiQuestionId', 'apiId'])
        if (childQuestionId) {
          childAliases.set(String(index), childQuestionId)
          childAliases.set(String(child.id), childQuestionId)
        }
      })
      dynamicRowAliases.set(id, childAliases)
      dynamicRowAliases.set(questionId, childAliases)
    }

    for (const child of children) {
      visit(child)
    }
  }

  for (const element of parsedTemplate.elements) {
    visit(element)
  }

  const normalized: Record<string, unknown> = { ...rawAnswers }
  for (const [id, questionId] of aliases) {
    if (Object.hasOwn(rawAnswers, id) && !Object.hasOwn(normalized, questionId)) {
      normalized[questionId] = rawAnswers[id]
    }
  }

  for (const [parentKey, childAliases] of dynamicRowAliases) {
    const rows = normalized[parentKey]
    if (!Array.isArray(rows)) {
      continue
    }

    normalized[parentKey] = rows.map(row => {
      if (!isRecord(row)) {
        return row
      }

      const normalizedRow: Record<string, unknown> = { ...row }
      for (const [childKey, childQuestionId] of childAliases) {
        if (Object.hasOwn(row, childKey) && !Object.hasOwn(normalizedRow, childQuestionId)) {
          normalizedRow[childQuestionId] = row[childKey]
        }
      }

      return normalizedRow
    })
  }

  return normalized
}

const coerceMappedNumber = (value: unknown): number => {
  const numberValue = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim())
  if (!Number.isFinite(numberValue)) {
    throw new Error('invalid number')
  }

  return numberValue
}

const coerceMappedBoolean = (value: unknown): boolean => {
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

  throw new Error('invalid boolean')
}

const coerceMappedDate = (value: unknown): string => {
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) {
    throw new Error('invalid date')
  }

  return date.toISOString()
}

const MAPPED_VALUE_COERCERS: Record<GcsGcFormsTransform, (value: unknown) => JsonValue> = {
  string: (value: unknown) => String(value),
  number: coerceMappedNumber,
  money: coerceMappedNumber,
  boolean: coerceMappedBoolean,
  date: coerceMappedDate,
  enum: (value: unknown) => String(value),
  bilingual_text: (value: unknown) => String(value),
  attachment: (value: unknown) => String(value),
  json: (value: unknown) => normalizeGcFormsJsonValue(JSON.parse(JSON.stringify(value)))
}

const coerceMappedValue = (value: unknown, transform: GcsGcFormsTransform): JsonValue => {
  if (value === null || value === undefined) {
    return null
  }

  return MAPPED_VALUE_COERCERS[transform](value)
}

const coerceMappedAnswerValue = (value: unknown, transform: GcsGcFormsTransform): JsonValue =>
  Array.isArray(value)
    ? value.map(item => coerceMappedValue(item, transform))
    : coerceMappedValue(value, transform)

const hasGcFormsMappedValue = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.some(item => hasGcFormsMappedValue(item))
  }

  return value !== undefined && value !== null && String(value).trim() !== ''
}

const dynamicRowAnswerValues = (
  answers: Record<string, unknown>,
  sourceQuestionId: string
): unknown[] | undefined => {
  if (!GCFORMS_CLAIM_LINE_ITEM_QUESTION_IDS.some(questionId => questionId === sourceQuestionId)) {
    return undefined
  }

  const rows = answers[GCFORMS_CLAIM_LINE_ITEMS_QUESTION_ID]
  if (!Array.isArray(rows)) {
    return undefined
  }

  return rows.map(row => isRecord(row) ? row[sourceQuestionId] : undefined)
}

const gcFormsAnswerValue = (
  answers: Record<string, unknown>,
  sourceQuestionId: string
): unknown => Object.hasOwn(answers, sourceQuestionId)
  ? answers[sourceQuestionId]
  : dynamicRowAnswerValues(answers, sourceQuestionId)

const createMappedValue = (
  mapping: GcsGcFormsFieldMapping,
  value: JsonValue
): GcsGcFormsMappedValue => ({
  mappingId: mapping.id,
  sourceQuestionId: mapping.sourceQuestionId,
  destinationEntity: mapping.destinationEntity,
  destinationPath: mapping.destinationPath,
  value
})

const createMappingIssue = (
  mapping: GcsGcFormsFieldMapping,
  code: GcsGcFormsMappingIssue['code']
): GcsGcFormsMappingIssue => ({
  mappingId: mapping.id,
  sourceQuestionId: mapping.sourceQuestionId,
  destinationPath: mapping.destinationPath,
  code,
  params: {
    destinationPath: mapping.destinationPath
  }
})

const getMappingDefaultValue = (mapping: GcsGcFormsFieldMapping): JsonValue =>
  mapping.defaultValue === undefined ? null : normalizeGcFormsJsonValue(mapping.defaultValue)

const previewMissingGcFormsValue = (
  mapping: GcsGcFormsFieldMapping
): { value?: GcsGcFormsMappedValue; issue?: GcsGcFormsMappingIssue } => {
  if (mapping.required || mapping.onMissing === 'block') {
    return {
      issue: createMappingIssue(mapping, 'missing_required_value')
    }
  }

  return mapping.onMissing === 'default'
    ? { value: createMappedValue(mapping, getMappingDefaultValue(mapping)) }
    : {}
}

const previewInvalidGcFormsValue = (
  mapping: GcsGcFormsFieldMapping
): { value?: GcsGcFormsMappedValue; issue?: GcsGcFormsMappingIssue; skip?: boolean } => {
  if (mapping.onInvalid === 'default') {
    return { value: createMappedValue(mapping, getMappingDefaultValue(mapping)) }
  }

  if (mapping.onInvalid === 'skip') {
    return { skip: true }
  }

  return {
    issue: createMappingIssue(mapping, 'invalid_value')
  }
}

const collectGcFormsPreviewResult = (
  result: { value?: GcsGcFormsMappedValue; issue?: GcsGcFormsMappingIssue; skip?: boolean },
  values: GcsGcFormsMappedValue[],
  issues: GcsGcFormsMappingIssue[]
) => {
  if (result.value) values.push(result.value)
  if (result.issue) issues.push(result.issue)
}

/** Applies configured transforms and failure modes to preview mapped values and validation issues. */
export const previewGcFormsMapping = (
  answers: Record<string, unknown>,
  mappings: GcsGcFormsFieldMapping[]
): { values: GcsGcFormsMappedValue[]; issues: GcsGcFormsMappingIssue[] } => {
  const values: GcsGcFormsMappedValue[] = []
  const issues: GcsGcFormsMappingIssue[] = []

  for (const mapping of mappings) {
    const rawValue = gcFormsAnswerValue(answers, mapping.sourceQuestionId)

    if (!hasGcFormsMappedValue(rawValue)) {
      const result = previewMissingGcFormsValue(mapping)
      collectGcFormsPreviewResult(result, values, issues)
      continue
    }

    try {
      values.push(createMappedValue(mapping, coerceMappedAnswerValue(rawValue, mapping.transform)))
    } catch {
      const result = previewInvalidGcFormsValue(mapping)
      collectGcFormsPreviewResult(result, values, issues)
    }
  }

  return { values, issues }
}
