// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import type { Ref } from 'vue'
import type {
  GcsExtensionJsonConfig,
  GcsResolvedExtension,
  JsonValue
} from '@gcs-ssc/extensions'
import { installExtensionTestUiRuntime } from '@gcs-ssc/extensions/testing'
import AgencyGcFormsIntegrationConfig from '../../components/AgencyGcFormsIntegrationConfig.vue'
import StreamGcFormsIntegrationConfig from '../../components/StreamGcFormsIntegrationConfig.vue'
import { parseGcFormsStreamConfig } from '../../shared/gcforms'

const extension: GcsResolvedExtension = {
  key: 'gcs-gcforms-integration',
  packageName: '@gcs-ssc/gcs-gcforms-integration',
  rootDir: '',
  sdkVersion: '0.2.0',
  requiredHostCapabilities: [],
  name: {
    en: 'GC Forms integration',
    fr: 'Integration GC Forms'
  },
  admin: {},
  client: {
    slots: [],
    tabs: [],
    createActions: [],
    paymentAmountCalculators: []
  },
  css: [],
  i18n: {},
  assets: [],
  serverHandlers: [],
  migrations: []
}

const InteractiveResourceLayout = defineComponent({
  inheritAttrs: false,
  setup: (_, { attrs, slots }) => () => {
    const rows = Array.isArray(attrs.data) ? attrs.data : []
    return h('div', rows.map((original, index) => {
      const rowId = original !== null && typeof original === 'object' && 'id' in original
        ? String(original.id)
        : String(index)

      return h('div', {
        'data-mapping-row': rowId
      }, [
        slots['sourceField-cell']?.({
          row: {
            id: rowId,
            original
          }
        }),
        slots['submission-cell']?.({
          row: {
            id: rowId,
            original
          }
        }),
        slots['failedOn-cell']?.({
          row: {
            id: rowId,
            original
          }
        }),
        slots['sourceValue-cell']?.({
          row: {
            id: rowId,
            original
          }
        }),
        slots['actions-cell']?.({
          row: {
            id: rowId,
            original
          }
        })
      ])
    }))
  }
})

const ReactiveModal = defineComponent({
  inheritAttrs: false,
  setup: (_, { attrs, slots }) => () => attrs.open === false
    ? null
    : h('div', [
        slots.header?.(),
        slots.body?.(),
        slots.footer?.(),
        slots.default?.()
      ])
})

const VisibleAlert = defineComponent({
  inheritAttrs: false,
  setup: (_, { attrs, slots }) => () => h('div', [
    String(attrs.title ?? ''),
    String(attrs.description ?? ''),
    slots.default?.()
  ])
})

const ExhaustiveResourceLayout = defineComponent({
  inheritAttrs: false,
  setup: (_, { attrs, slots }) => () => {
    const rows = Array.isArray(attrs.data) ? attrs.data : []
    const tableRows = rows.map((original, index) => ({
      id: String((original as { id?: unknown })?.id ?? index),
      original
    }))
    const groupRow = tableRows.length === 0
      ? null
      : {
          id: 'mappingGroup:claim',
          original: tableRows[0]?.original,
          groupingColumnId: 'mappingGroup',
          subRows: tableRows,
          leafRows: tableRows,
          getIsGrouped: () => true,
          getIsExpanded: () => true,
          toggleExpanded: vi.fn()
        }
    const slotNames = [
      'hostField-cell', 'requirement-cell', 'sourceField-cell',
      'submission-cell', 'failedOn-cell', 'sourceValue-cell', 'actions-cell'
    ]
    const rendered = [groupRow, ...tableRows].flatMap(row => row === null
      ? []
      : slotNames.flatMap(name => slots[name]?.({ row }) ?? []))
    return h('div', [
      ...rendered,
      ...(slots.empty?.() ?? []),
      ...(slots['footer-left']?.() ?? [])
    ])
  }
})

const jsonResponse = (value: unknown): Response => new Response(JSON.stringify(value), {
  status: 200,
  headers: {
    'content-type': 'application/json'
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  installExtensionTestUiRuntime()
})

describe('AgencyGcFormsIntegrationConfig', () => {
  it('renders the Agency-owned submission status field in French', async () => {
    vi.stubGlobal('useI18n', () => ({
      locale: ref('fr'),
      t: (key: string) => key,
      n: (value: number) => String(value)
    }))
    installExtensionTestUiRuntime()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: [] })))
    const wrapper = mount(AgencyGcFormsIntegrationConfig, {
      props: { agencyId: '20', extension, modelValue: {} }
    })
    await flushPromises()

    expect(wrapper.find('[label="Statut des réclamations importées"]').exists()).toBe(true)
    expect(wrapper.find('[description="Le statut Brouillon de l’organisation attribué aux réclamations matérialisées à partir des soumissions GC Forms."]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('settles after updating a reactive parent model', async () => {
    const runtime = installExtensionTestUiRuntime()
    runtime.components.CommonStatusSelect = defineComponent({
      inheritAttrs: false,
      emits: ['update:modelValue'],
      setup: (_, { attrs, emit }) => () => h('select', {
        'data-submission-status': '',
        'value': String(attrs.modelValue ?? ''),
        'onChange': (event: Event) => {
          emit('update:modelValue', (event.target as HTMLSelectElement).value)
        }
      }, [h('option', { value: '91' }, 'Submitted')])
    })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: [] })))
    const parentModel: Ref<GcsExtensionJsonConfig> = ref({})
    const updateModel = vi.fn((value: GcsExtensionJsonConfig) => {
      parentModel.value = value
    })
    const Host = defineComponent({
      setup: () => () => h(AgencyGcFormsIntegrationConfig, {
        'agencyId': '20',
        'extension': extension,
        'modelValue': parentModel.value,
        'onUpdate:modelValue': updateModel
      })
    })
    const wrapper = mount(Host)
    await flushPromises()

    await wrapper.get('[data-submission-status]').setValue('91')
    await flushPromises()

    expect(parentModel.value).toMatchObject({ submissionStatusId: '91' })
    expect(updateModel).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('stores the Agency-owned status selected for imported claims', async () => {
    const runtime = installExtensionTestUiRuntime()
    runtime.components.CommonStatusSelect = defineComponent({
      inheritAttrs: false,
      emits: ['update:modelValue'],
      setup: (_, { attrs, emit }) => () => h('select', {
        'data-submission-status': '',
        'value': String(attrs.modelValue ?? ''),
        'data-agency-id': String(attrs.agencyId ?? attrs['agency-id'] ?? ''),
        'data-draft-only': String(attrs.draftOnly ?? attrs['draft-only'] ?? false),
        'onChange': (event: Event) => {
          emit('update:modelValue', (event.target as HTMLSelectElement).value)
        }
      }, [h('option', { value: '91' }, 'Submitted')])
    })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: [] })))
    const updates = vi.fn()
    const wrapper = mount(AgencyGcFormsIntegrationConfig, {
      props: {
        agencyId: '20',
        extension,
        modelValue: {},
        'onUpdate:modelValue': updates
      }
    })
    await flushPromises()

    const select = wrapper.get('[data-submission-status]')
    expect(select.attributes('data-agency-id')).toBe('20')
    expect(select.attributes('data-draft-only')).toBe('true')
    await select.setValue('91')
    await flushPromises()

    expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({
      submissionStatusId: '91'
    }))
    wrapper.unmount()
  })

  it('submits unchanged authentication fields during a name-only edit without resending the private key', async () => {
    installExtensionTestUiRuntime()
    let patchBody: Record<string, unknown> | null = null
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patchBody = JSON.parse(String(init.body)) as Record<string, unknown>
        return jsonResponse({ ok: true })
      }
      return jsonResponse({
        items: [{
          id: 'credential-1',
          name_en: 'Original credential',
          name_fr: 'Justificatif original',
          keyId: 'key-id-1',
          userId: 'user-id-1',
          formId: 'form-id-1',
          revision: 1,
          updatedAt: null
        }]
      })
    }))

    const wrapper = mount(AgencyGcFormsIntegrationConfig, {
      props: {
        agencyId: 'agency-1',
        extension,
        modelValue: {}
      }
    })
    await flushPromises()
    const editButton = wrapper.findAll('button').find(button => button.text() === 'i-lucide-pencil')
    if (!editButton) {
      throw new Error('Expected the credential edit button.')
    }
    await editButton.trigger('click')
    await flushPromises()
    const nameInput = wrapper.findAll('input')
      .find(input => (input.element as HTMLInputElement).value === 'Original credential')
    if (!nameInput) {
      throw new Error('Expected the credential English name input.')
    }
    await nameInput.setValue('Renamed credential')
    const saveButton = wrapper.findAll('button').find(button => button.text() === 'Save credential')
    if (!saveButton) {
      throw new Error('Expected the credential save button.')
    }
    await saveButton.trigger('click')
    await flushPromises()

    expect(patchBody).toMatchObject({
      name_en: 'Renamed credential',
      keyId: 'key-id-1',
      userId: 'user-id-1',
      formId: 'form-id-1'
    })
    expect(patchBody).not.toHaveProperty('key')
    wrapper.unmount()
  })
})

describe('StreamGcFormsIntegrationConfig', () => {
  it('emits normalized JSON while replacing one mapping in place', async () => {
    const runtime = installExtensionTestUiRuntime()
    runtime.components.CommonResourceLayoutCard = InteractiveResourceLayout
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      return url.includes('/materialization-failures')
        ? jsonResponse({ items: [], agreements: [] })
        : jsonResponse({ fieldCatalog: [], templateShapeChanged: false })
    })
    vi.stubGlobal('fetch', fetchMock)

    const beforeDefault: Record<string, JsonValue> = Object.fromEntries([
      ['__proto__', { preserved: true }],
      ['amount', Number.POSITIVE_INFINITY]
    ])
    const parentModel: Ref<GcsExtensionJsonConfig> = ref({
      credentialId: 'credential-1',
      templateShapeChanged: false,
      mappings: [
        {
          id: 'map-before',
          sourceQuestionId: 'before-source',
          destinationEntity: 'claim',
          destinationPath: 'egcs_fc_before',
          transform: 'json',
          required: false,
          defaultValue: beforeDefault,
          onMissing: 'default',
          onInvalid: 'default'
        },
        {
          id: 'agreement-number',
          sourceQuestionId: 'legacy-source',
          destinationEntity: 'claim',
          destinationPath: 'egcs_fc_fundingagreement',
          transform: 'string',
          required: true,
          defaultValue: { stale: true },
          onMissing: 'block',
          onInvalid: 'block'
        },
        {
          id: 'map-after',
          sourceQuestionId: 'after-source',
          destinationEntity: 'claim',
          destinationPath: 'egcs_fc_after',
          transform: 'string',
          required: false,
          onMissing: 'skip',
          onInvalid: 'block'
        }
      ]
    })
    const updateModel = vi.fn((value: GcsExtensionJsonConfig) => {
      parentModel.value = value
    })
    const Host = defineComponent({
      setup: () => () => h(StreamGcFormsIntegrationConfig, {
        'extension': extension,
        'streamId': 'stream-1',
        'modelValue': parentModel.value,
        'onUpdate:modelValue': updateModel
      })
    })
    const wrapper = mount(Host)
    await flushPromises()
    updateModel.mockClear()

    await wrapper.get('[data-mapping-row="agreement-number"] select').setValue('fiscal_year')
    await flushPromises()

    const emittedConfig = updateModel.mock.calls.at(-1)?.[0]
    if (!emittedConfig) {
      throw new Error('Expected a model update.')
    }
    const mappings = parseGcFormsStreamConfig(emittedConfig).mappings
    const normalizedBeforeDefault = mappings[0]?.defaultValue
    if (
      normalizedBeforeDefault === null
      || typeof normalizedBeforeDefault !== 'object'
      || Array.isArray(normalizedBeforeDefault)
    ) {
      throw new Error('Expected normalized mapping default.')
    }

    expect(mappings.map(mapping => mapping.id)).toEqual([
      'map-before',
      'agreement-number',
      'map-after'
    ])
    expect(mappings[0]).toMatchObject({
      sourceQuestionId: 'before-source',
      destinationPath: 'egcs_fc_before'
    })
    expect(mappings[1]).toMatchObject({
      sourceQuestionId: 'fiscal_year',
      destinationPath: 'egcs_fc_fundingagreement'
    })
    expect(mappings[1]).not.toHaveProperty('defaultValue')
    expect(mappings[2]).toMatchObject({
      sourceQuestionId: 'after-source',
      destinationPath: 'egcs_fc_after'
    })
    expect(JSON.stringify(normalizedBeforeDefault)).toBe(
      '{"__proto__":{"preserved":true},"amount":null}'
    )
    expect(Object.hasOwn(normalizedBeforeDefault, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(normalizedBeforeDefault)).toBe(Object.prototype)
    expect(Reflect.get(normalizedBeforeDefault, 'preserved')).toBeUndefined()

    const serialized = JSON.stringify(emittedConfig)
    expect(JSON.stringify(JSON.parse(serialized))).toBe(serialized)

    wrapper.unmount()
  })

  it('runs template, save, download, and sync actions through the host clients', async () => {
    const runtime = installExtensionTestUiRuntime()
    runtime.components.CommonResourceLayoutCard = InteractiveResourceLayout
    runtime.components.UModal = ReactiveModal
    runtime.components.UAlert = VisibleAlert
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/credentials')) {
        return jsonResponse({ items: [] })
      }
      if (url.endsWith('/claim-template')) {
        return jsonResponse({ elements: [] })
      }
      if (url.endsWith('/sync')) {
        return jsonResponse({
          runId: 'run-1',
          discovered: 1,
          imported: 1,
          skipped: 0,
          problems: 1
        })
      }
      if (url.includes('/materialization-failures')) {
        return jsonResponse({
          items: [{
            submissionId: 'submission-1',
            submissionName: 'Claim submission',
            agreementNumber: 'AGR-001',
            selectedAgreementId: 'agreement-1',
            diagnostic: {
              code: 'agreement_not_found',
              params: { destinationPath: 'claim.egcs_fc_fundingagreement' }
            },
            issues: [{
              destinationPath: 'claim.egcs_fc_fundingagreement',
              code: 'agreement_not_found',
              params: { destinationPath: 'claim.egcs_fc_fundingagreement' }
            }],
            createdAt: '2026-07-24T12:00:00.000Z'
          }],
          agreements: [{
            id: 'agreement-1',
            agreementNumber: 'AGR-001',
            label: 'AGR-001'
          }]
        })
      }
      if (url.endsWith('/template')) {
        return jsonResponse({ fieldCatalog: [], templateShapeChanged: false })
      }
      if (url.endsWith('/api/extensions/streams/stream-1') && init?.method === 'PATCH') {
        return jsonResponse({ ok: true })
      }

      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:gcforms-template')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const linkClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    const parentModel: Ref<GcsExtensionJsonConfig> = ref({
      credentialId: 'credential-1',
      templateShapeChanged: false,
      mappings: []
    })
    const Host = defineComponent({
      setup: () => () => h(StreamGcFormsIntegrationConfig, {
        'extension': extension,
        'streamId': 'stream-1',
        'agencyId': 'agency-1',
        'streamEnabled': true,
        'modelValue': parentModel.value,
        'onUpdate:modelValue': (value: GcsExtensionJsonConfig) => {
          parentModel.value = value
        }
      })
    })
    const wrapper = mount(Host)
    await flushPromises()

    const clickButton = async (label: string) => {
      const button = wrapper.findAll('button').find(candidate => candidate.text() === label)
      if (!button) {
        throw new Error(`Expected ${label} button.`)
      }
      await button.trigger('click')
      await flushPromises()
    }

    await clickButton('Refresh template')
    await clickButton('Save')
    await clickButton('Download claim form')
    await clickButton('Sync submissions')
    expect(wrapper.text()).toContain('Sync complete')
    await clickButton('Review failed materializations')
    const matchAction = wrapper.findAll('button')
      .find(button => button.text() === 'i-lucide-link')
    if (!matchAction) {
      throw new Error('Expected failed-submission match action.')
    }
    await matchAction.trigger('click')
    await flushPromises()
    await clickButton('Match')

    const requests = fetchMock.mock.calls.map(([input]) => String(input))
    expect(requests).toEqual(expect.arrayContaining([
      '/api/extensions/gcs-gcforms-integration/agencies/agency-1/credentials',
      '/api/extensions/gcs-gcforms-integration/streams/stream-1/template',
      '/api/extensions/streams/stream-1',
      '/api/extensions/gcs-gcforms-integration/streams/stream-1/claim-template',
      '/api/extensions/gcs-gcforms-integration/streams/stream-1/sync',
      '/api/extensions/gcs-gcforms-integration/streams/stream-1/materialization-failures/submission-1/agreement'
    ]))
    expect(linkClick).toHaveBeenCalledOnce()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:gcforms-template')

    wrapper.unmount()
  })

  it('renders persisted diagnostics in French and never trusts raw API display text', async () => {
    vi.stubGlobal('useI18n', () => ({
      locale: ref('fr'),
      t: (key: string) => key,
      n: (value: number) => String(value)
    }))
    const runtime = installExtensionTestUiRuntime()
    runtime.components.CommonResourceLayoutCard = InteractiveResourceLayout
    runtime.components.UModal = ReactiveModal
    runtime.components.UAlert = VisibleAlert
    const rawDetail = 'SQLSTATE 23505 secret@example.test'
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/credentials')) {
        return jsonResponse({ items: [] })
      }
      if (url.endsWith('/sync')) {
        return jsonResponse({ runId: 'run-fr', discovered: 1, imported: 0, skipped: 0, problems: 1 })
      }
      if (url.includes('/materialization-failures') && init?.method === 'POST') {
        return jsonResponse({ ok: true, status: 'imported' })
      }
      if (url.includes('/materialization-failures')) {
        return jsonResponse({
          items: [{
            submissionId: 'submission-fr',
            submissionName: 'Réclamation française',
            agreementNumber: 'AGR-INTROUVABLE',
            selectedAgreementId: 'agreement-1',
            diagnostic: {
              code: 'agreement_not_found',
              params: { destinationPath: 'claim.egcs_fc_fundingagreement' },
              message: rawDetail
            },
            issues: [{
              destinationPath: 'claim.egcs_fc_fundingagreement',
              code: 'agreement_not_found',
              params: { destinationPath: 'claim.egcs_fc_fundingagreement' },
              message: rawDetail
            }],
            createdAt: '2026-07-24T12:00:00.000Z'
          }],
          agreements: [{ id: 'agreement-1', agreementNumber: 'AGR-001', label: 'AGR-001' }]
        })
      }
      return jsonResponse({ fieldCatalog: [], templateShapeChanged: false })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(StreamGcFormsIntegrationConfig, {
      props: {
        extension,
        streamId: 'stream-1',
        agencyId: 'agency-1',
        streamEnabled: true,
        modelValue: { credentialId: 'credential-1', mappings: [] }
      }
    })
    await flushPromises()

    const clickButton = async (label: string) => {
      const button = wrapper.findAll('button').find(candidate => candidate.text() === label)
      if (!button) {
        throw new Error(`Expected ${label} button.`)
      }
      await button.trigger('click')
      await flushPromises()
    }
    await clickButton('Synchroniser les soumissions')
    await clickButton('Verifier les materialisations echouees')

    const localized = 'L’entente pour claim.egcs_fc_fundingagreement est introuvable dans ce volet de paiements de transfert.'
    expect(wrapper.text()).toContain(localized)
    expect(wrapper.text()).not.toContain(rawDetail)
    expect(wrapper.text()).not.toContain('could not be found')

    const matchAction = wrapper.findAll('button').find(button => button.text() === 'i-lucide-link')
    if (!matchAction) {
      throw new Error('Expected the French failed-submission match action.')
    }
    await matchAction.trigger('click')
    await flushPromises()
    await clickButton('Associer')

    const diagnosticRequests = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/materialization-failures')
    )
    expect(diagnosticRequests.length).toBeGreaterThan(1)
    for (const [, init] of diagnosticRequests) {
      expect(new Headers(init?.headers).get('accept-language')).toBe('fr')
    }
    wrapper.unmount()
  })

  it('reports failed template, save, download, and sync actions', async () => {
    const runtime = installExtensionTestUiRuntime()
    runtime.components.UModal = ReactiveModal
    runtime.components.UAlert = VisibleAlert
    const toastAdd = vi.fn()
    runtime.composables.useToast = () => ({ add: toastAdd })

    let failActions = false
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const isAction = (
        url.endsWith('/claim-template')
        || url.endsWith('/sync')
        || (url.endsWith('/template') && method === 'POST')
        || (url.endsWith('/api/extensions/streams/stream-1') && method === 'PATCH')
      )
      if (failActions && isAction) {
        throw new Error(`Request failed: ${url}`)
      }
      if (url.includes('/materialization-failures')) {
        return jsonResponse({ items: [], agreements: [] })
      }

      return jsonResponse({ fieldCatalog: [], templateShapeChanged: false })
    }))

    const parentModel: Ref<GcsExtensionJsonConfig> = ref({
      credentialId: 'credential-1',
      templateShapeChanged: false,
      mappings: []
    })
    const Host = defineComponent({
      setup: () => () => h(StreamGcFormsIntegrationConfig, {
        'extension': extension,
        'streamId': 'stream-1',
        'modelValue': parentModel.value,
        'onUpdate:modelValue': (value: GcsExtensionJsonConfig) => {
          parentModel.value = value
        }
      })
    })
    const wrapper = mount(Host)
    await flushPromises()
    failActions = true

    const clickButton = async (label: string) => {
      const button = wrapper.findAll('button').find(candidate => candidate.text() === label)
      if (!button) {
        throw new Error(`Expected ${label} button.`)
      }
      await button.trigger('click')
      await flushPromises()
    }

    await clickButton('Refresh template')
    await clickButton('Save')
    await clickButton('Download claim form')
    await clickButton('Sync submissions')

    expect(toastAdd.mock.calls.map(([notification]) => notification.title)).toEqual([
      'Template refresh failed',
      'Save failed',
      'Claim form download failed'
    ])
    expect(wrapper.text()).toContain('Sync failed')
    expect(wrapper.text()).toContain('Request failed:')

    wrapper.unmount()
  })

  it('covers malformed catalogs, fallback mappings, searches, and alternate workspace states', async () => {
    vi.stubGlobal('useI18n', () => ({
      locale: ref('fr'),
      t: (key: string) => key,
      n: (value: number) => String(value)
    }))
    const runtime = installExtensionTestUiRuntime()
    runtime.components.CommonResourceLayoutCard = ExhaustiveResourceLayout
    runtime.components.UModal = ReactiveModal
    runtime.components.UAlert = VisibleAlert

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/template')) {
        return jsonResponse({
          templateShapeChanged: true,
          fieldCatalog: [
            null,
            {},
            { questionId: 'missing-type' },
            { questionId: 'plain', type: 'text' },
            {
              id: 'repeated-id',
              questionId: 'repeated',
              type: 'dynamicRow',
              label_en: 'Repeated English',
              label_fr: 'Répété français',
              required: true,
              tags: ['line_item', 42]
            }
          ]
        })
      }
      return jsonResponse({
          items: [
            {
              submissionId: 'submission-no-issue',
              submissionName: 'No issue',
              agreementNumber: null,
              selectedAgreementId: null,
              diagnostic: null,
              issues: [],
              createdAt: '2026-01-01T00:00:00.000Z'
            },
            {
              submissionId: 'submission-other',
              submissionName: 'Other target',
              agreementNumber: 'AGR-2',
              selectedAgreementId: null,
              diagnostic: { code: 'other', params: { opaque: 'Other failure' } },
              issues: [{ destinationPath: 'claim.other', code: 'other', params: { opaque: 'Other message' } }],
              createdAt: '2026-01-02T00:00:00.000Z'
            }
          ],
          agreements: [
            { id: 'agreement-1', agreementNumber: 'AGR-1', label: 'Agreement One' },
            { id: 'agreement-2', agreementNumber: 'AGR-2', label: 'Agreement Two' }
          ]
        })
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(StreamGcFormsIntegrationConfig, {
      props: {
        extension,
        streamId: 'stream-1',
        hostLayout: true,
        modelValue: {
          credentialId: null,
          templateShapeChanged: true,
          mappings: [
            {
              id: 'final-for-year', sourceQuestionId: '__gcforms_final_for_year',
              destinationEntity: 'claim', destinationPath: 'egcs_fc_finalforyear',
              transform: 'boolean', required: false, onMissing: 'skip', onInvalid: 'block'
            },
            {
              id: 'optional-existing', sourceQuestionId: 'duplicate-source',
              destinationEntity: 'claim', destinationPath: 'optional',
              transform: 'string', required: false, onMissing: 'skip', onInvalid: 'block'
            }
          ]
        }
      }
    })
    await flushPromises()

    type StreamSetupState = {
      parseFieldCatalog: (value: unknown) => Array<Record<string, unknown>>
      errorDescription: (value: unknown) => string
      fieldSelectValue: (field: Record<string, unknown>) => string
      upsertClaimMapping: (field: Record<string, unknown>, sourceQuestionId: unknown) => void
      localConfig: { mappings: Array<Record<string, unknown>> }
      mappingFieldSearch: string
      failedMaterializationSearch: string
      matchSearchTerm: string
      failedMaterializations: Array<Record<string, unknown>>
      agreementOptions: Array<Record<string, unknown>>
      mappingFieldRows: unknown[]
      filteredFailedMaterializations: unknown[]
      searchedAgreementSelectOptions: unknown[]
      refreshTemplate: () => Promise<void>
      syncSubmissions: () => Promise<void>
      saveConfiguration: () => Promise<void>
      downloadClaimTemplate: () => Promise<void>
      resolveMaterializationFailure: () => Promise<void>
      refreshMaterializationFailures: () => Promise<void>
      openMatchModal: (submission: Record<string, unknown>) => void
      statusMessage: string
      isSaving: boolean
      isDownloadingClaimTemplate: boolean
      selectedTab: string
    }
    const setupState = (wrapper.vm as unknown as {
      $: { setupState: unknown }
    }).$.setupState as StreamSetupState
    expect(setupState.parseFieldCatalog('invalid')).toEqual([])
    expect(setupState.parseFieldCatalog([
      12,
      { questionId: 'missing-type' },
      { questionId: 'fallbacks', type: 'text', tags: 'invalid' },
      { id: 'full', questionId: 'full', type: 'dynamicRow', label_en: 'English', label_fr: 'Français', tags: ['line_item', 4] }
    ])).toEqual([
      {
        id: 'fallbacks', questionId: 'fallbacks', type: 'text',
        label_en: 'fallbacks', label_fr: 'fallbacks', required: false, tags: []
      },
      {
        id: 'full', questionId: 'full', type: 'dynamicRow',
        label_en: 'English', label_fr: 'Français', required: false, tags: ['line_item']
      }
    ])

    expect(setupState.errorDescription('primitive failure')).toBe('primitive failure')
    expect(setupState.fieldSelectValue({ id: 'missing', sourceQuestionId: '', destinationPath: 'x' }))
      .toBe('__gcforms_no_source_field')
    setupState.upsertClaimMapping({
      id: 'optional-existing', destinationPath: 'optional', transform: 'string', required: false, repeat: false
    }, null)
    expect(setupState.localConfig.mappings.some((mapping: { id: string }) => mapping.id === 'optional-existing')).toBe(false)
    setupState.upsertClaimMapping({
      id: 'defaulted', destinationPath: 'defaulted', transform: 'number', required: true,
      repeat: true, sourceQuestionId: 'fallback-source', defaultValue: 0
    }, undefined)
    expect(setupState.localConfig.mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'defaulted', sourceQuestionId: 'fallback-source', destinationEntity: 'claim_line_item',
        onMissing: 'block', onInvalid: 'block', defaultValue: 0
      })
    ]))

    setupState.failedMaterializations = [
      {
        submissionId: 'submission-no-issue', submissionName: 'No issue', agreementNumber: null,
        selectedAgreementId: null, diagnostic: null, issues: [], createdAt: '2026-01-01T00:00:00.000Z'
      },
      {
        submissionId: 'submission-other', submissionName: 'Other target', agreementNumber: 'AGR-2',
        selectedAgreementId: null, diagnostic: { code: 'other', params: { opaque: 'Other failure' } },
        issues: [{ destinationPath: 'claim.other', code: 'other', params: { opaque: 'Other message' } }],
        createdAt: '2026-01-02T00:00:00.000Z'
      }
    ]
    setupState.agreementOptions = [
      { id: 'agreement-1', agreementNumber: 'AGR-1', label: 'Agreement One' },
      { id: 'agreement-2', agreementNumber: 'AGR-2', label: 'Agreement Two' }
    ]
    await setupState.refreshMaterializationFailures()
    setupState.mappingFieldSearch = 'repeated'
    setupState.failedMaterializationSearch = 'terminer cette correspondance'
    setupState.matchSearchTerm = 'agreement two'
    await nextTick()
    expect(setupState.mappingFieldRows.length).toBeGreaterThan(0)
    expect(Array.isArray(setupState.filteredFailedMaterializations)).toBe(true)
    expect(Array.isArray(setupState.searchedAgreementSelectOptions)).toBe(true)

    await setupState.refreshTemplate()
    await setupState.syncSubmissions()
    expect(setupState.statusMessage).toContain('Selectionnez')
    setupState.isSaving = true
    setupState.isDownloadingClaimTemplate = true
    await setupState.saveConfiguration()
    await setupState.downloadClaimTemplate()

    setupState.selectedTab = 'failed-materializations'
    await nextTick()
    expect(fetchMock.mock.calls.map(([input]) => String(input)))
      .toEqual(expect.arrayContaining([expect.stringContaining('/materialization-failures')]))
    expect(setupState.failedMaterializations).not.toHaveLength(0)
    setupState.openMatchModal(setupState.failedMaterializations[1]!)
    await nextTick()
    expect(wrapper.text()).toContain('Aucun outil de correspondance')
    await setupState.resolveMaterializationFailure()

    setupState.selectedTab = 'fundingcaseforecast'
    await nextTick()
    expect(wrapper.text()).toContain('En cours')
    expect(wrapper.html()).toContain('gcforms-config-page-content')
    wrapper.unmount()
  })
})
