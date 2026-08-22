import { describe, expect, it } from 'vitest'
import {
  GcFormsTemplateElementSchema,
  gcFormsTemplateShapesEqual,
  normalizeGcFormsAnswers,
  normalizeGcFormsJsonValue,
  normalizeGcFormsTemplate,
  parseGcFormsAgencyConfig,
  parseGcFormsStreamConfig,
  previewGcFormsMapping,
  upsertGcFormsFieldMapping
} from '../../shared/gcforms'

describe('GC Forms shared mapping utilities', () => {
  it('validates recursively nested template elements', () => {
    expect(GcFormsTemplateElementSchema.safeParse({
      id: 'parent',
      type: 'dynamicRow',
      elements: [{
        id: 'child',
        type: 'textField',
        elements: [{ id: 'missing-type' }]
      }]
    }).success).toBe(false)
  })

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

  it('ignores malformed property-based child elements', () => {
    const catalog = normalizeGcFormsTemplate({
      elements: [{
        id: 'parent',
        type: 'dynamicRow',
        properties: {
          subElements: [
            null,
            { id: 'missing-type' },
            {
              id: 'valid-child',
              type: 'textField',
              properties: { questionId: 'valid_question' }
            }
          ]
        }
      }]
    })

    expect(catalog.map(field => field.questionId)).toEqual(['parent', 'valid_question'])
  })

  it('projects unknown nested values into JSON-compatible data', () => {
    expect(normalizeGcFormsJsonValue({
      z: undefined,
      a: ['value', undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      bigint: 9007199254740993n,
      date: new Date('2026-01-02T03:04:05.000Z'),
      invalidDate: new Date(Number.NaN),
      callback: () => 'ignored'
    })).toEqual({
      a: ['value', null, null, null, null],
      bigint: '9007199254740993',
      callback: expect.any(String),
      date: '2026-01-02T03:04:05.000Z',
      invalidDate: null,
      z: null
    })
  })

  it('preserves __proto__ as a JSON data property', () => {
    const normalized = normalizeGcFormsJsonValue(JSON.parse(
      '{"__proto__":{"polluted":true},"safe":1}'
    ))

    expect(JSON.stringify(normalized)).toBe(
      '{"__proto__":{"polluted":true},"safe":1}'
    )
    expect(Object.getPrototypeOf(normalized)).toBe(Object.prototype)
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

  it('preserves __proto__ JSON answers without changing the result prototype', () => {
    const config = parseGcFormsStreamConfig({
      mappings: [{
        id: 'map-json',
        sourceQuestionId: 'metadata',
        destinationEntity: 'claim',
        destinationPath: 'egcs_fc_metadata',
        transform: 'json'
      }]
    })
    const metadata = JSON.parse('{"__proto__":{"polluted":true},"safe":1}')
    const value = previewGcFormsMapping({ metadata }, config.mappings).values[0]?.value
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Expected mapped JSON object.')
    }

    expect(JSON.stringify(value)).toBe('{"__proto__":{"polluted":true},"safe":1}')
    expect(Object.hasOwn(value, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
    expect(Reflect.get(value, 'polluted')).toBeUndefined()
  })

  it('normalizes configured defaults before returning mapped JSON values', () => {
    const config = parseGcFormsStreamConfig({
      mappings: [{
        id: 'map-default',
        sourceQuestionId: 'missing',
        destinationEntity: 'claim',
        destinationPath: 'egcs_fc_metadata',
        transform: 'json',
        required: false,
        defaultValue: {
          present: true,
          omitted: undefined
        },
        onMissing: 'default',
        onInvalid: 'default'
      }]
    })

    expect(previewGcFormsMapping({}, config.mappings).values[0]?.value).toEqual({
      omitted: null,
      present: true
    })
  })

  it('replaces stale mapping defaults and appends new mappings', () => {
    const existing = parseGcFormsStreamConfig({
      mappings: [
        {
          id: 'map-before',
          sourceQuestionId: 'before-source',
          destinationEntity: 'claim',
          destinationPath: 'egcs_fc_before',
          transform: 'string'
        },
        {
          id: 'map-default',
          sourceQuestionId: 'old-source',
          destinationEntity: 'claim',
          destinationPath: 'egcs_fc_metadata',
          transform: 'json',
          defaultValue: { stale: true }
        },
        {
          id: 'map-after',
          sourceQuestionId: 'after-source',
          destinationEntity: 'claim',
          destinationPath: 'egcs_fc_after',
          transform: 'string'
        }
      ]
    }).mappings
    const nextMapping = parseGcFormsStreamConfig({
      mappings: [{
        id: 'map-default',
        sourceQuestionId: 'new-source',
        destinationEntity: 'claim',
        destinationPath: 'egcs_fc_metadata',
        transform: 'json'
      }]
    }).mappings[0]
    if (!nextMapping) {
      throw new Error('Expected parsed mapping.')
    }
    const [beforeMapping, staleMapping, afterMapping] = existing
    if (!beforeMapping || !staleMapping || !afterMapping) {
      throw new Error('Expected existing mapping fixtures.')
    }

    const replaced = upsertGcFormsFieldMapping(existing, nextMapping)
    const appendedMapping = {
      ...nextMapping,
      id: 'map-appended'
    }
    const appended = upsertGcFormsFieldMapping(existing, appendedMapping)

    expect(replaced.map(mapping => mapping.id)).toEqual(['map-before', 'map-default', 'map-after'])
    expect(replaced[0]).toBe(beforeMapping)
    expect(replaced[1]).toBe(nextMapping)
    expect(replaced[2]).toBe(afterMapping)
    expect(replaced[1]).not.toHaveProperty('defaultValue')
    expect(staleMapping).toHaveProperty('defaultValue')
    expect(appended.map(mapping => mapping.id)).toEqual([
      'map-before',
      'map-default',
      'map-after',
      'map-appended'
    ])
    expect(appended[0]).toBe(beforeMapping)
    expect(appended[1]).toBe(staleMapping)
    expect(appended[2]).toBe(afterMapping)
    expect(appended[3]).toBe(appendedMapping)
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
      apiUrl: 'https://gcforms.example.test/v1'
    })).toEqual({
      apiUrl: 'https://gcforms.example.test/v1',
      confirmSubmissions: false
    })
  })

  it.each([
    'http://gcforms.example.test/v1',
    'https://localhost:3000/v1',
    'https://127.0.0.1/v1',
    'https://169.254.169.254/latest',
    'https://10.0.0.4/v1',
    'https://user:password@gcforms.example.test/v1',
    'https://gcforms.example.test/v1?token=secret'
  ])('rejects unsafe GC Forms remote endpoint %s', (apiUrl) => {
    expect(() => parseGcFormsAgencyConfig({ apiUrl })).toThrow()
  })

  it('treats cleared config fields as absent values', () => {
    expect(parseGcFormsAgencyConfig({ apiUrl: null })).toEqual({
      confirmSubmissions: false
    })
    expect(parseGcFormsStreamConfig({
      credentialId: ' 1 ',
      identityProviderUrl: '',
      preferredLanguage: 'en',
      mappings: []
    })).toMatchObject({
      credentialId: '1',
      confirmSubmissions: false,
      preferredLanguage: 'en',
      mappings: []
    })
  })

  it('parses credential id and ignores legacy form id fields as runtime sources', () => {
    const config = parseGcFormsStreamConfig({
      credentialId: ' 12 ',
      formId: ' legacy-form ',
      claim: {
        formId: 'legacy-claim-form'
      }
    })

    expect(config).toMatchObject({
      credentialId: '12',
      mappings: []
    })
    expect('formId' in config).toBe(false)
    expect('claim' in config).toBe(false)
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

  it.each(['0', '-1', 'abc', '9223372036854775808'])(
    'rejects invalid PostgreSQL bigint status id %s',
    submissionStatusId => {
      expect(() => parseGcFormsStreamConfig({ submissionStatusId })).toThrow()
    }
  )
})
