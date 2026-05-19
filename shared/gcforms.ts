/* eslint-disable jsdoc/require-jsdoc */
import { z } from 'zod'
import type { GcsExtensionJsonConfig, JsonValue } from '@gcs-ssc/extensions'

export const GCFORMS_EXTENSION_KEY = 'gcs-gcforms-integration'

export const DEFAULT_GCFORMS_API_URL = 'https://api.forms-formulaires.alpha.canada.ca/v1'
export const DEFAULT_GCFORMS_IDP_URL = 'https://auth.forms-formulaires.alpha.canada.ca'
export const DEFAULT_GCFORMS_PROJECT_IDENTIFIER = '284778202772022819'
export const GCFORMS_CLAIM_LINE_ITEMS_QUESTION_ID = 'submitted_line_items'
export const GCFORMS_CLAIM_LINE_ITEM_QUESTION_IDS = [
  'submitted_cost_category',
  'submitted_cost_subsection',
  'submitted_line_item',
  'submitted_amount'
] as const
export const GCFORMS_CLAIM_REQUIRED_QUESTION_IDS = [
  'agreement_number',
  'fiscal_year',
  'claim_period_start_month',
  'claim_period_end_month',
  GCFORMS_CLAIM_LINE_ITEMS_QUESTION_ID,
  ...GCFORMS_CLAIM_LINE_ITEM_QUESTION_IDS
] as const

export const GcFormsPrivateApiKeySchema = z.object({
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

export type GcFormsCredentialCreate = z.infer<typeof GcFormsCredentialCreateSchema>

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

export const GcFormsAttachmentSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  downloadLink: z.string(),
  isPotentiallyMalicious: z.boolean(),
  md5: z.string().optional()
})

export type GcFormsAttachment = z.infer<typeof GcFormsAttachmentSchema>

export const GcFormsDecryptedSubmissionSchema = z.object({
  createdAt: z.coerce.number(),
  status: z.string(),
  confirmationCode: z.string(),
  answers: z.string(),
  checksum: z.string(),
  attachments: z.array(GcFormsAttachmentSchema).optional()
})

export type GcFormsDecryptedSubmission = z.infer<typeof GcFormsDecryptedSubmissionSchema>

export const GcFormsTemplateElementSchema: z.ZodType<GcFormsTemplateElement> = z.lazy(() => z.object({
  id: z.union([z.string(), z.number()]),
  type: z.string(),
  properties: z.record(z.string(), z.unknown()).optional(),
  elements: z.array(GcFormsTemplateElementSchema).optional()
})) as unknown as z.ZodType<GcFormsTemplateElement>

export interface GcFormsTemplateElement {
  id: string | number
  type: string
  properties?: Record<string, unknown>
  elements?: GcFormsTemplateElement[]
}

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

export const GcsDestinationEntitySchema = z.enum([
  'agreement',
  'proponent',
  'claim',
  'claim_line_item',
  'monitor',
  'source_record'
])

export type GcsDestinationEntity = z.infer<typeof GcsDestinationEntitySchema>

export const GcsGcFormsTransformSchema = z.enum([
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

export const GcsGcFormsFailureModeSchema = z.enum(['block', 'skip', 'default'])
export type GcsGcFormsFailureMode = z.infer<typeof GcsGcFormsFailureModeSchema>

const OptionalStringSchema = z.preprocess(
  value => typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined,
  z.string().optional()
)

export const GcsGcFormsFieldMappingSchema = z.object({
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

export const GcsGcFormsAgencyConfigSchema = z.object({
  apiUrl: OptionalStringSchema,
  identityProviderUrl: OptionalStringSchema,
  confirmSubmissions: z.boolean().default(false)
})

export type GcsGcFormsAgencyConfig = z.infer<typeof GcsGcFormsAgencyConfigSchema>

export const GcsGcFormsStreamConfigSchema = z.object({
  credentialId: OptionalStringSchema,
  apiUrl: OptionalStringSchema,
  identityProviderUrl: OptionalStringSchema,
  projectIdentifier: OptionalStringSchema,
  contactEmail: OptionalStringSchema,
  preferredLanguage: z.enum(['en', 'fr']).default('en'),
  confirmSubmissions: z.boolean().default(false),
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

export interface GcsGcFormsMappingIssue {
  mappingId: string
  sourceQuestionId: string
  destinationPath: string
  code: 'missing_required_value' | 'invalid_value' | 'agreement_not_found' | 'materialization_failed'
  message: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

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
    return subElements.filter(isRecord) as unknown as GcFormsTemplateElement[]
  }

  return []
}

const normalizeJsonValue = (value: unknown): JsonValue => {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeJsonValue(item))
  }

  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value)
      .sort()
      .map(key => [key, normalizeJsonValue(value[key])])) as JsonValue
  }

  return String(value)
}

const choicesProperty = (properties: Record<string, unknown> | undefined): JsonValue[] => {
  const rawChoices = properties?.choices
  if (!Array.isArray(rawChoices)) {
    return []
  }

  return rawChoices.map(choice => normalizeJsonValue(choice))
}

const stableStringify = (value: unknown): string => JSON.stringify(normalizeJsonValue(value))

export const normalizeGcFormsTemplate = (template: unknown): GcFormsFieldCatalogItem[] => {
  const parsed = GcFormsFormTemplateSchema.parse(template)
  const fields: GcFormsFieldCatalogItem[] = []

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

export const normalizeGcFormsTemplateShape = (template: unknown): GcFormsTemplateShapeElement[] => {
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

export const gcFormsTemplateShapesEqual = (left: unknown, right: unknown): boolean =>
  stableStringify(normalizeGcFormsTemplateShape(left)) === stableStringify(normalizeGcFormsTemplateShape(right))

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

export const parseGcFormsStreamConfig = (config: GcsExtensionJsonConfig | unknown): GcsGcFormsStreamConfig =>
  GcsGcFormsStreamConfigSchema.parse(config ?? {})

export const parseGcFormsAgencyConfig = (config: GcsExtensionJsonConfig | unknown): GcsGcFormsAgencyConfig =>
  GcsGcFormsAgencyConfigSchema.parse(config ?? {})

export const normalizeGcFormsAnswers = (
  answers: string | Record<string, unknown>,
  template?: unknown
): Record<string, unknown> => {
  const rawAnswers = (() => {
    if (typeof answers !== 'string') {
      return answers
    }

    const parsed = JSON.parse(answers) as unknown
    return isRecord(parsed) ? parsed : {}
  })()

  if (!template) {
    return rawAnswers
  }

  const parsedTemplate = GcFormsFormTemplateSchema.parse(template)
  const aliases = new Map<string, string>()
  const dynamicRowAliases = new Map<string, Map<string, string>>()
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
  json: (value: unknown) => JSON.parse(JSON.stringify(value)) as JsonValue
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
  if (!GCFORMS_CLAIM_LINE_ITEM_QUESTION_IDS.includes(sourceQuestionId as typeof GCFORMS_CLAIM_LINE_ITEM_QUESTION_IDS[number])) {
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
  code: GcsGcFormsMappingIssue['code'],
  message: string
): GcsGcFormsMappingIssue => ({
  mappingId: mapping.id,
  sourceQuestionId: mapping.sourceQuestionId,
  destinationPath: mapping.destinationPath,
  code,
  message
})

const getMappingDefaultValue = (mapping: GcsGcFormsFieldMapping): JsonValue =>
  mapping.defaultValue === undefined ? null : mapping.defaultValue as JsonValue

const previewMissingGcFormsValue = (
  mapping: GcsGcFormsFieldMapping
): { value?: GcsGcFormsMappedValue; issue?: GcsGcFormsMappingIssue } => {
  if (mapping.required || mapping.onMissing === 'block') {
    return {
      issue: createMappingIssue(mapping, 'missing_required_value', 'Required GC Forms value is missing.')
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
    issue: createMappingIssue(mapping, 'invalid_value', 'GC Forms value cannot be transformed for the selected destination.')
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
