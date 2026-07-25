// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import type { Ref } from 'vue'
import type {
  GcsExtensionJsonConfig,
  GcsResolvedExtension,
  JsonValue
} from '@gcs-ssc/extensions'
import { installExtensionTestUiRuntime } from '@gcs-ssc/extensions/testing'
import StreamGcFormsIntegrationConfig from '../../components/StreamGcFormsIntegrationConfig.vue'
import { parseGcFormsStreamConfig } from '../../shared/gcforms'

const extension: GcsResolvedExtension = {
  key: 'gcs-gcforms-integration',
  packageName: '@gcs-ssc/gcs-gcforms-integration',
  rootDir: '',
  sdkVersion: '0.1.0',
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

describe('StreamGcFormsIntegrationConfig', () => {
  it('emits normalized JSON while replacing one mapping in place', async () => {
    const runtime = installExtensionTestUiRuntime()
    runtime.components.CommonResourceLayoutCard = InteractiveResourceLayout
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input)
      return url.includes('/materialization-failures')
        ? jsonResponse({ items: [], agreements: [] })
        : jsonResponse({ fieldCatalog: [], templateShapeChanged: false })
    }))

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
            lastError: 'Agreement was not found.',
            issues: [{
              destinationPath: 'claim.egcs_fc_fundingagreement',
              code: 'agreement_not_found',
              message: 'Agreement was not found.'
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
})
