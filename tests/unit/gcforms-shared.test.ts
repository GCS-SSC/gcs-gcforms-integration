import { describe, expect, it } from 'vitest'
import {
  gcFormsTemplateShapesEqual,
  normalizeGcFormsAnswers,
  normalizeGcFormsTemplate,
  parseGcFormsAgencyConfig,
  parseGcFormsStreamConfig,
  previewGcFormsMapping
} from '../../shared/gcforms'

describe('GC Forms shared mapping utilities', () => {
  it('normalizes form template elements into a field catalog', () => {
    const catalog = normalizeGcFormsTemplate({
      titleEn: 'Claim form',
      titleFr: 'Formulaire de reclamation',
      elements: [
        {
          id: 1,
          type: 'textField',
          properties: {
            questionId: 'agreement_id',
            titleEn: 'Agreement',
            titleFr: 'Entente',
            validation: { required: true },
            additionalTags: ['gcs']
          }
        },
        {
          id: 2,
          type: 'dynamicRow',
          properties: {
            titleEn: 'Lines',
            titleFr: 'Lignes',
            subElements: [
              {
                id: '2.1',
                type: 'number',
                properties: {
                  apiQuestionId: 'amount',
                  titleEn: 'Amount',
                  titleFr: 'Montant'
                }
              }
            ]
          }
        }
      ]
    })

    expect(catalog).toEqual([
      expect.objectContaining({
        id: '1',
        questionId: 'agreement_id',
        label_en: 'Agreement',
        label_fr: 'Entente',
        required: true,
        tags: ['gcs']
      }),
      expect.objectContaining({
        id: '2',
        questionId: '2',
        type: 'dynamicRow'
      }),
      expect.objectContaining({
        id: '2.1',
        questionId: 'amount',
        label_en: 'Amount',
        label_fr: 'Montant'
      })
    ])
  })

  it('compares the stored form shape independently of non-shape labels', () => {
    const baseTemplate = {
      elements: [
        {
          id: 1,
          type: 'textField',
          properties: {
            questionId: 'agreement_id',
            titleEn: 'Agreement',
            validation: { required: true }
          }
        }
      ]
    }
    const relabelledTemplate = {
      elements: [
        {
          id: 1,
          type: 'textField',
          properties: {
            questionId: 'agreement_id',
            titleEn: 'Agreement number',
            validation: { required: true }
          }
        }
      ]
    }
    const changedTemplate = {
      elements: [
        {
          id: 1,
          type: 'number',
          properties: {
            questionId: 'agreement_id',
            titleEn: 'Agreement',
            validation: { required: true }
          }
        }
      ]
    }

    expect(gcFormsTemplateShapesEqual(baseTemplate, relabelledTemplate)).toBe(true)
    expect(gcFormsTemplateShapesEqual(baseTemplate, changedTemplate)).toBe(false)
  })

  it('previews mapped values and reports user-correctable mapping issues', () => {
    const config = parseGcFormsStreamConfig({
      preferredLanguage: 'en',
      mappings: [
        {
          id: 'map-amount',
          sourceQuestionId: 'amount',
          destinationEntity: 'claim_line_item',
          destinationPath: 'egcs_fc_amount',
          transform: 'money',
          required: true,
          onMissing: 'block',
          onInvalid: 'block'
        },
        {
          id: 'map-missing',
          sourceQuestionId: 'missing',
          destinationEntity: 'agreement',
          destinationPath: 'egcs_fc_name_en',
          transform: 'string',
          required: true,
          onMissing: 'block',
          onInvalid: 'block'
        }
      ]
    })

    const preview = previewGcFormsMapping(
      normalizeGcFormsAnswers(JSON.stringify({ amount: '1,234.56' })),
      config.mappings
    )

    expect(preview.values).toEqual([
      expect.objectContaining({
        mappingId: 'map-amount',
        value: 1234.56
      })
    ])
    expect(preview.issues).toEqual([
      expect.objectContaining({
        mappingId: 'map-missing',
        code: 'missing_required_value'
      })
    ])
  })

  it('parses agency-level GC Forms base URL configuration', () => {
    expect(parseGcFormsAgencyConfig({
      apiUrl: 'http://localhost:3000/v1'
    })).toEqual({
      apiUrl: 'http://localhost:3000/v1'
    })
  })

  it('treats cleared config fields as absent values', () => {
    expect(parseGcFormsAgencyConfig({ apiUrl: null })).toEqual({})
    expect(parseGcFormsStreamConfig({
      credentialId: null,
      formId: ' form-1 ',
      identityProviderUrl: '',
      preferredLanguage: 'en',
      mappings: []
    })).toMatchObject({
      formId: 'form-1',
      confirmSubmissions: false,
      preferredLanguage: 'en',
      mappings: []
    })
  })

  it('normalizes numeric answer keys to template question ids', () => {
    const answers = normalizeGcFormsAnswers(JSON.stringify({
      '1': 'AGR-0001',
      '2': '2025-2026'
    }), {
      elements: [
        {
          id: 1,
          type: 'textField',
          properties: {
            questionId: 'agreement_number'
          }
        },
        {
          id: 2,
          type: 'dropdown',
          properties: {
            questionId: 'fiscal_year'
          }
        }
      ]
    })

    expect(answers).toEqual({
      '1': 'AGR-0001',
      '2': '2025-2026',
      agreement_number: 'AGR-0001',
      fiscal_year: '2025-2026'
    })
  })

  it('parses confirm submissions stream config with a disabled default', () => {
    expect(parseGcFormsStreamConfig({}).confirmSubmissions).toBe(false)
    expect(parseGcFormsStreamConfig({ confirmSubmissions: true }).confirmSubmissions).toBe(true)
  })
})
