import { describe, expect, it } from 'vitest'
import {
  gcFormsTemplateShapesEqual,
  normalizeGcFormsAnswers,
  normalizeGcFormsTemplate,
  parseGcFormsAgencyConfig,
  parseGcFormsStreamConfig,
  previewGcFormsMapping,
  resolveGcFormsClaimFormId
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

  it('previews dynamic row claim line items as aligned mapped arrays', () => {
    const config = parseGcFormsStreamConfig({
      preferredLanguage: 'en',
      mappings: [
        {
          id: 'submitted-line',
          sourceQuestionId: 'submitted_line_item',
          destinationEntity: 'claim_line_item',
          destinationPath: 'egcs_fc_submittedlineitem',
          transform: 'string',
          required: true,
          onMissing: 'block',
          onInvalid: 'block'
        },
        {
          id: 'submitted-amount',
          sourceQuestionId: 'submitted_amount',
          destinationEntity: 'claim_line_item',
          destinationPath: 'egcs_fc_amount',
          transform: 'money',
          required: true,
          onMissing: 'block',
          onInvalid: 'block'
        }
      ]
    })

    const preview = previewGcFormsMapping(
      normalizeGcFormsAnswers({
        submitted_line_items: [
          { submitted_line_item: 'Equipment', submitted_amount: '30.00' },
          { submitted_line_item: 'Travel', submitted_amount: '75.00' }
        ]
      }),
      config.mappings
    )

    expect(preview.issues).toEqual([])
    expect(preview.values).toEqual([
      expect.objectContaining({
        mappingId: 'submitted-line',
        value: ['Equipment', 'Travel']
      }),
      expect.objectContaining({
        mappingId: 'submitted-amount',
        value: [30, 75]
      })
    ])
  })

  it('parses agency-level GC Forms base URL configuration', () => {
    expect(parseGcFormsAgencyConfig({
      apiUrl: 'http://localhost:3000/v1'
    })).toEqual({
      apiUrl: 'http://localhost:3000/v1',
      confirmSubmissions: false
    })
  })

  it('treats cleared config fields as absent values', () => {
    expect(parseGcFormsAgencyConfig({ apiUrl: null })).toEqual({
      confirmSubmissions: false
    })
    expect(parseGcFormsStreamConfig({
      credentialId: null,
      claim: {
        formId: ' form-1 '
      },
      identityProviderUrl: '',
      preferredLanguage: 'en',
      mappings: []
    })).toMatchObject({
      claim: {
        formId: 'form-1'
      },
      confirmSubmissions: false,
      preferredLanguage: 'en',
      mappings: []
    })
  })

  it('keeps legacy top-level form ID as a compatibility fallback', () => {
    const config = parseGcFormsStreamConfig({
      formId: ' legacy-form '
    })

    expect(config.formId).toBe('legacy-form')
    expect(resolveGcFormsClaimFormId(config)).toBe('legacy-form')
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

  it('normalizes numeric dynamic row child keys to template question ids', () => {
    const answers = normalizeGcFormsAnswers(JSON.stringify({
      '5': [
        { '0': 'Operating Costs', '1': 'Administration', '2': 'Equipment', '3': '11.11' }
      ]
    }), {
      elements: [
        {
          id: 5,
          type: 'dynamicRow',
          properties: {
            questionId: 'submitted_line_items'
          },
          elements: [
            { id: 501, type: 'dropdown', properties: { questionId: 'submitted_cost_category' } },
            { id: 502, type: 'dropdown', properties: { questionId: 'submitted_cost_subsection' } },
            { id: 503, type: 'dropdown', properties: { questionId: 'submitted_line_item' } },
            { id: 504, type: 'textField', properties: { questionId: 'submitted_amount' } }
          ]
        }
      ]
    })

    expect(answers.submitted_line_items).toEqual([
      expect.objectContaining({
        submitted_cost_category: 'Operating Costs',
        submitted_cost_subsection: 'Administration',
        submitted_line_item: 'Equipment',
        submitted_amount: '11.11'
      })
    ])
  })

  it('parses confirm submissions stream config with a disabled default', () => {
    expect(parseGcFormsStreamConfig({}).confirmSubmissions).toBe(false)
    expect(parseGcFormsStreamConfig({ confirmSubmissions: true }).confirmSubmissions).toBe(true)
  })
})
