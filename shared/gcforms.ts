/* eslint-disable jsdoc/require-jsdoc */
import { z } from 'zod'
import type { GcsExtensionJsonConfig, JsonValue } from '@gcs-ssc/extensions'

export const GCFORMS_EXTENSION_KEY = 'gcs-gcforms-integration'

export const DEFAULT_GCFORMS_API_URL = 'https://api.forms-formulaires.alpha.canada.ca/v1'
export const DEFAULT_GCFORMS_IDP_URL = 'https://auth.forms-formulaires.alpha.canada.ca'
export const DEFAULT_GCFORMS_PROJECT_IDENTIFIER = '284778202772022819'

export const GcFormsPrivateApiKeySchema = z.object({
  keyId: z.string().min(1),
  key: z.string().min(1),
  userId: z.string().min(1),
  formId: z.string().min(1)
})

export type GcFormsPrivateApiKey = z.infer<typeof GcFormsPrivateApiKeySchema>

export const GcFormsCredentialInputSchema = GcFormsPrivateApiKeySchema.extend({
  credentialId: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_.:-]+$/)
})

export type GcFormsCredentialInput = z.infer<typeof GcFormsCredentialInputSchema>

export interface GcFormsCredentialSummary {
  credentialId: string
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
  apiUrl: OptionalStringSchema
})

export type GcsGcFormsAgencyConfig = z.infer<typeof GcsGcFormsAgencyConfigSchema>

export const GcsGcFormsStreamConfigSchema = z.object({
  credentialId: OptionalStringSchema,
  formId: OptionalStringSchema,
  apiUrl: OptionalStringSchema,
  identityProviderUrl: OptionalStringSchema,
  projectIdentifier: OptionalStringSchema,
  contactEmail: OptionalStringSchema,
  preferredLanguage: z.enum(['en', 'fr']).default('en'),
  confirmSubmissions: z.boolean().default(false),
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
  const visit = (element: GcFormsTemplateElement) => {
    const id = String(element.id)
    const questionId = stringProperty(element.properties, ['questionId', 'apiQuestionId', 'apiId'])
    if (questionId) {
      aliases.set(id, questionId)
    }
    for (const child of childElements(element)) {
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

  return normalized
}

const coerceMappedValue = (value: unknown, transform: GcsGcFormsTransform): JsonValue => {
  if (value === null || value === undefined) {
    return null
  }

  if (transform === 'number' || transform === 'money') {
    const numberValue = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim())
    if (!Number.isFinite(numberValue)) {
      throw new Error('invalid number')
    }
    return numberValue
  }

  if (transform === 'boolean') {
    if (typeof value === 'boolean') {
      return value
    }
    const normalized = String(value).trim().toLowerCase()
    if (['true', 'yes', 'y', '1', 'oui'].includes(normalized)) return true
    if (['false', 'no', 'n', '0', 'non'].includes(normalized)) return false
    throw new Error('invalid boolean')
  }

  if (transform === 'date') {
    const date = new Date(String(value))
    if (Number.isNaN(date.getTime())) {
      throw new Error('invalid date')
    }
    return date.toISOString()
  }

  if (transform === 'json') {
    return JSON.parse(JSON.stringify(value)) as JsonValue
  }

  return String(value)
}

export const previewGcFormsMapping = (
  answers: Record<string, unknown>,
  mappings: GcsGcFormsFieldMapping[]
): { values: GcsGcFormsMappedValue[]; issues: GcsGcFormsMappingIssue[] } => {
  const values: GcsGcFormsMappedValue[] = []
  const issues: GcsGcFormsMappingIssue[] = []

  for (const mapping of mappings) {
    const rawValue = answers[mapping.sourceQuestionId]
    const hasValue = rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== ''

    if (!hasValue) {
      if (mapping.required || mapping.onMissing === 'block') {
        issues.push({
          mappingId: mapping.id,
          sourceQuestionId: mapping.sourceQuestionId,
          destinationPath: mapping.destinationPath,
          code: 'missing_required_value',
          message: 'Required GC Forms value is missing.'
        })
        continue
      }

      if (mapping.onMissing === 'default') {
        values.push({
          mappingId: mapping.id,
          sourceQuestionId: mapping.sourceQuestionId,
          destinationEntity: mapping.destinationEntity,
          destinationPath: mapping.destinationPath,
          value: mapping.defaultValue === undefined ? null : mapping.defaultValue as JsonValue
        })
      }
      continue
    }

    try {
      values.push({
        mappingId: mapping.id,
        sourceQuestionId: mapping.sourceQuestionId,
        destinationEntity: mapping.destinationEntity,
        destinationPath: mapping.destinationPath,
        value: coerceMappedValue(rawValue, mapping.transform)
      })
    } catch {
      if (mapping.onInvalid === 'default') {
        values.push({
          mappingId: mapping.id,
          sourceQuestionId: mapping.sourceQuestionId,
          destinationEntity: mapping.destinationEntity,
          destinationPath: mapping.destinationPath,
          value: mapping.defaultValue === undefined ? null : mapping.defaultValue as JsonValue
        })
        continue
      }

      if (mapping.onInvalid === 'skip') {
        continue
      }

      issues.push({
        mappingId: mapping.id,
        sourceQuestionId: mapping.sourceQuestionId,
        destinationPath: mapping.destinationPath,
        code: 'invalid_value',
        message: 'GC Forms value cannot be transformed for the selected destination.'
      })
    }
  }

  return { values, issues }
}
