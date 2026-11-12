// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { installExtensionTestUiRuntime } from '@gcs-ssc/extensions/testing'
import type { GcsExtensionJsonConfig, GcsResolvedExtension } from '@gcs-ssc/extensions'
import StreamConfig from '../../components/StreamGcFormsIntegrationConfig.vue'

const extension: GcsResolvedExtension = {
  key: 'gcs-gcforms-integration', packageName: '@gcs-ssc/gcs-gcforms-integration', rootDir: '',
  sdkVersion: '0.2.0', requiredHostCapabilities: [], name: { en: 'Forms', fr: 'Formulaires' },
  admin: {}, client: { slots: [], tabs: [], createActions: [], paymentAmountCalculators: [] },
  css: [], i18n: {}, assets: [], serverHandlers: [], migrations: []
}
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}
const field = (id: string) => ({ questionId: id, type: 'text', label_en: `${id} field`, label_fr: id })
const failure = (id: string) => ({
  submissionId: id, submissionName: id, selectedAgreementId: 'agreement-1', agreementNumber: 'AGR-1',
  diagnostic: null, issues: [{ destinationPath: 'claim.egcs_fc_fundingagreement', code: 'agreement_not_found', params: {} }], createdAt: ''
})
const install = () => {
  const runtime = installExtensionTestUiRuntime()
  const add = vi.fn()
  const locale = ref('en')
  runtime.composables.useI18n = () => ({ locale, n: (value: number) => String(value) })
  runtime.composables.useToast = () => ({ add })
  runtime.components.CommonResourceLayout = defineComponent({
    inheritAttrs: false,
    setup: (_, { attrs, slots }) => () => h('div', (Array.isArray(attrs.data) ? attrs.data : []).map(original =>
      h('div', [String(original.fieldLabel ?? original.submissionName ?? ''), slots['actions-cell']?.({ row: { original } })])
    ).concat(Array.isArray(attrs.data) && attrs.data.length === 0 ? slots.empty?.() ?? [] : []))
  })
  runtime.components.UAlert = defineComponent({
    inheritAttrs: false,
    setup: (_, { attrs, slots }) => () => h('div', { role: attrs.role }, [String(attrs.title ?? ''), String(attrs.description ?? ''), slots.actions?.()])
  })
  runtime.components.UModal = defineComponent({
    inheritAttrs: false,
    setup: (_, { attrs, slots }) => () => attrs.open === false ? null : h('section', { 'data-modal': '' }, [
      String(attrs.title ?? ''), slots.body?.(), slots.footer?.()
    ])
  })
  return { add, locale }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); installExtensionTestUiRuntime() })

describe('Stream request ownership', () => {
  it('keeps the replacement stream catalog when an old template resolves late', async () => {
    install()
    const old = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const path = String(input)
      if (path.endsWith('/streams/first/template')) return old.promise
      return json(path.endsWith('/template') ? { fieldCatalog: [field('current')] } : { items: [], agreements: [] })
    }))
    const wrapper = mount(StreamConfig, { props: { extension, streamId: 'first', agencyId: 'agency', modelValue: {} } })
    await flushPromises()
    await wrapper.setProps({ streamId: 'second' })
    await flushPromises()
    expect(wrapper.text()).toContain('current field')
    old.resolve(json({ fieldCatalog: [field('obsolete')], templateShapeChanged: true }))
    await flushPromises()
    expect(wrapper.text()).toContain('current field')
    expect(wrapper.text()).not.toContain('obsolete field')
    wrapper.unmount()
  })

  it('rejects earlier template feedback when the credential draft changes', async () => {
    install()
    const old = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => String(input).endsWith('/template')
      ? old.promise : json({ items: [], agreements: [] })))
    const wrapper = mount(StreamConfig, { props: {
      extension, streamId: 'first', modelValue: { credentialId: 'first-credential' }
    } })
    await flushPromises()
    await wrapper.setProps({ modelValue: { credentialId: 'replacement-credential' } })
    await flushPromises()
    old.resolve(json({ fieldCatalog: [field('obsolete')], templateShapeChanged: true }))
    await flushPromises()
    expect(wrapper.text()).not.toContain('obsolete field')
    const updates = wrapper.emitted('update:modelValue') ?? []
    expect(updates.every(([value]) => typeof value === 'object' && value !== null
      && 'templateShapeChanged' in value && value.templateShapeChanged !== true)).toBe(true)
    wrapper.unmount()
  })

  it('does not report a previous stream save after identity replacement or unmount', async () => {
    const { add } = install()
    const old = deferred<Response>()
    let patches = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === 'PATCH') { patches++; return old.promise }
      return json({ items: [], fieldCatalog: [], agreements: [] })
    }))
    const wrapper = mount(StreamConfig, { props: { extension, streamId: 'first', modelValue: {} } })
    await flushPromises()
    const save = wrapper.findAll('button').find(button => button.text() === 'Save')!
    await save.trigger('click')
    await save.trigger('click')
    expect(patches).toBe(1)
    await wrapper.setProps({ streamId: 'second' })
    await flushPromises()
    wrapper.unmount()
    old.resolve(json({ ok: true }))
    await flushPromises()
    expect(add).not.toHaveBeenCalled()
  })

  it('does not close a replacement failure match when an earlier match finishes', async () => {
    install()
    const old = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      if (init?.method === 'POST' && String(input).endsWith('/agreement')) return old.promise
      return json(String(input).endsWith('/materialization-failures') ? {
        items: [failure('First submission'), failure('Second submission')], agreements: [{ id: 'agreement-1', agreementNumber: 'AGR-1', label: 'Agreement' }]
      } : { items: [], fieldCatalog: [] })
    }))
    const wrapper = mount(StreamConfig, { props: { extension, streamId: 'first', modelValue: {} } })
    await flushPromises()
    // Standalone host tabs do not render triggers; select their canonical navigation model.
    const state = wrapper.vm.$.setupState as { selectedTab: string }
    state.selectedTab = 'failed-materializations'
    await flushPromises()
    const matches = wrapper.findAll('button[aria-label="Match"]')
    expect(matches).toHaveLength(2)
    await matches[0]!.trigger('click')
    await wrapper.findAll('[data-modal] button').find(button => button.text() === 'Match')!.trigger('click')
    await matches[1]!.trigger('click')
    old.resolve(json({ ok: true }))
    await flushPromises()
    expect(wrapper.find('[data-modal]').text()).toContain('Second submission')
    wrapper.unmount()
  })
  it('reports failure-queue read errors without claiming the queue is empty and retries to true empty evidence', async () => {
    const { locale } = install()
    let unavailable = true
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      if (String(input).endsWith('/materialization-failures') && unavailable) throw new Error('offline')
      return json({ items: [], fieldCatalog: [], agreements: [] })
    }))
    const wrapper = mount(StreamConfig, { props: { extension, streamId: 'first', modelValue: {} } })
    await flushPromises()
    const state = wrapper.vm.$.setupState as { selectedTab: string }
    state.selectedTab = 'failed-materializations'
    await flushPromises()
    expect(wrapper.text()).not.toContain('No failed claim materializations need review.')
    expect(wrapper.get('[role="alert"]').text()).toContain('Failed materializations could not be loaded.')
    locale.value = 'fr'
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Impossible de charger les matérialisations échouées.')
    locale.value = 'en'
    await flushPromises()
    unavailable = false
    await wrapper.findAll('button').find(button => button.text() === 'Refresh failures')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('No failed claim materializations need review.')
    wrapper.unmount()
  })

  it('offers independent read recovery for unavailable credentials and stored templates', async () => {
    install()
    let unavailable = true
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const path = String(input)
      if (unavailable && (path.endsWith('/credentials') || path.endsWith('/template'))) throw new Error('offline')
      return json(path.endsWith('/template') ? { fieldCatalog: [field('Recovered')] } : { items: [], agreements: [] })
    }))
    const wrapper = mount(StreamConfig, { props: { extension, agencyId: 'agency', streamId: 'first', modelValue: {} } })
    await flushPromises()
    expect(wrapper.findAll('[role="alert"]').map(alert => alert.text())).toEqual(expect.arrayContaining([
      expect.stringContaining('Credentials could not be loaded.'), expect.stringContaining('The saved template could not be loaded.')
    ]))
    unavailable = false
    await wrapper.findAll('button').find(button => button.text() === 'Retry loading credentials')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === 'Retry loading the template')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Recovered field')
    wrapper.unmount()
  })

  it('explains matching API errors within the current session and clears them on retry and replacement', async () => {
    install()
    const retried = deferred<Response>()
    let posts = 0
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      if (init?.method === 'POST' && String(input).endsWith('/agreement')) {
        posts += 1
        return posts === 1 ? new Response(JSON.stringify({ message: 'The selected agreement is no longer available.' }), { status: 409, headers: { 'content-type': 'application/json' } }) : retried.promise
      }
      return json(String(input).endsWith('/materialization-failures') ? {
        items: [failure('First submission'), failure('Second submission')], agreements: [{ id: 'agreement-1', agreementNumber: 'AGR-1', label: 'Agreement' }]
      } : { items: [], fieldCatalog: [] })
    }))
    const wrapper = mount(StreamConfig, { props: { extension, streamId: 'first', modelValue: {} } })
    await flushPromises()
    const state = wrapper.vm.$.setupState as { selectedTab: string }
    state.selectedTab = 'failed-materializations'
    await flushPromises()
    const matches = wrapper.findAll('button[aria-label="Match"]')
    await matches[0]!.trigger('click')
    const submit = () => wrapper.findAll('[data-modal] button').find(button => button.text() === 'Match')!
    await submit().trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-modal] [role="alert"]').text()).toContain('The selected agreement is no longer available.')
    await submit().trigger('click')
    expect(wrapper.find('[data-modal] [role="alert"]').exists()).toBe(false)
    await matches[1]!.trigger('click')
    retried.resolve(new Response(JSON.stringify({ message: 'Obsolete failure' }), { status: 409, headers: { 'content-type': 'application/json' } }))
    await flushPromises()
    expect(wrapper.get('[data-modal]').text()).toContain('Second submission')
    expect(wrapper.find('[data-modal] [role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Obsolete failure')
    wrapper.unmount()
  })

  it('uses localized matching failure recovery when transport provides no user message', async () => {
    const { locale } = install()
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') throw new Error('network unavailable')
      return json(String(input).endsWith('/materialization-failures') ? {
        items: [failure('Submission')], agreements: [{ id: 'agreement-1', agreementNumber: 'AGR-1', label: 'Agreement' }]
      } : { items: [], fieldCatalog: [] })
    }))
    const wrapper = mount(StreamConfig, { props: { extension, streamId: 'first', modelValue: {} } })
    await flushPromises()
    const state = wrapper.vm.$.setupState as { selectedTab: string }
    state.selectedTab = 'failed-materializations'
    await flushPromises()
    await wrapper.get('button[aria-label="Match"]').trigger('click')
    await wrapper.findAll('[data-modal] button').find(button => button.text() === 'Match')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-modal] [role="alert"]').text()).toContain('The submission could not be matched.')
    locale.value = 'fr'
    await flushPromises()
    expect(wrapper.get('[data-modal] [role="alert"]').text()).toContain('Impossible d’associer la soumission.')
    await wrapper.findAll('[data-modal] button').find(button => button.text() === 'Fermer')!.trigger('click')
    await wrapper.get('button[aria-label="Associer"]').trigger('click')
    expect(wrapper.find('[data-modal] [role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('retains controlled template drift and accepted fields through failed reads until an accepted retry settles them', async () => {
    install()
    let templateResult: 'failure' | 'drifted' | 'current' = 'failure'
    const saved: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const path = String(input)
      if (init?.method === 'PATCH') { saved.push(JSON.parse(String(init.body))); return json({}) }
      if (path.endsWith('/sync')) throw new Error('sync unavailable')
      if (path.endsWith('/template')) {
        if (templateResult === 'failure') throw new Error('template unavailable')
        return json({ templateShapeChanged: templateResult === 'drifted', fieldCatalog: [field(templateResult === 'drifted' ? 'Accepted' : 'Current')] })
      }
      return json({ items: [], agreements: [] })
    }))
    const model = ref<GcsExtensionJsonConfig>({ credentialId: 'credential', templateShapeChanged: true, mappings: [] })
    const parent = defineComponent({ setup: () => () => h(StreamConfig, {
      extension, agencyId: 'agency', streamId: 'first', modelValue: model.value,
      'onUpdate:modelValue': (value: GcsExtensionJsonConfig) => { model.value = value }
    }) })
    const wrapper = mount(parent)
    const button = (label: string) => wrapper.findAll('button').find(item => item.text() === label)!
    await flushPromises()
    expect(wrapper.text()).toContain('The saved template could not be loaded.')
    expect(model.value.templateShapeChanged).toBe(true)
    expect(wrapper.text()).toContain('GC Forms template shape changed')
    await button('Save').trigger('click')
    await flushPromises()
    expect(saved[0]).toMatchObject({ config: { templateShapeChanged: true } })
    templateResult = 'drifted'
    await button('Retry loading the template').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Accepted field')
    expect(model.value.templateShapeChanged).toBe(true)
    templateResult = 'failure'
    await button('Sync submissions').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('The saved template could not be loaded.')
    expect(wrapper.text()).toContain('Accepted field')
    expect(model.value.templateShapeChanged).toBe(true)
    templateResult = 'current'
    await button('Retry loading the template').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('The saved template could not be loaded.')
    expect(wrapper.text()).not.toContain('Accepted field')
    expect(wrapper.text()).toContain('Current field')
    expect(model.value.templateShapeChanged).toBe(false)
    await button('Save').trigger('click')
    await flushPromises()
    expect(saved[1]).toMatchObject({ config: { templateShapeChanged: false } })
    wrapper.unmount()
  })

  it.each(['stream', 'agency', 'credential'] as const)('clears template evidence on %s replacement and rejects earlier read settlement', async identity => {
    install()
    const earlier = deferred<Response>()
    const replacement = deferred<Response>()
    let templateReads = 0
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const path = String(input)
      if (path.endsWith('/sync')) throw new Error('sync unavailable')
      if (path.endsWith('/template')) {
        templateReads += 1
        if (templateReads === 1) return json({ templateShapeChanged: true, fieldCatalog: [field('Accepted')] })
        return templateReads === 2 ? earlier.promise : replacement.promise
      }
      return json({ items: [], agreements: [] })
    }))
    const model = ref<GcsExtensionJsonConfig>({ credentialId: 'credential', templateShapeChanged: true, mappings: [] })
    const stream = ref('first')
    const agency = ref('agency')
    const parent = defineComponent({ setup: () => () => h(StreamConfig, {
      extension, agencyId: agency.value, streamId: stream.value, modelValue: model.value,
      'onUpdate:modelValue': (value: GcsExtensionJsonConfig) => { model.value = value }
    }) })
    const wrapper = mount(parent)
    await flushPromises()
    expect(wrapper.text()).toContain('Accepted field')
    await wrapper.findAll('button').find(button => button.text() === 'Sync submissions')!.trigger('click')
    await flushPromises()
    model.value = { ...model.value, templateShapeChanged: false, ...(identity === 'credential' ? { credentialId: 'replacement' } : {}) }
    if (identity === 'stream') stream.value = 'second'
    if (identity === 'agency') agency.value = 'other-agency'
    await flushPromises()
    expect(wrapper.text()).not.toContain('Accepted field')
    expect(model.value.templateShapeChanged).toBe(false)
    earlier.resolve(json({ templateShapeChanged: true, fieldCatalog: [field('Obsolete')] }))
    await flushPromises()
    expect(wrapper.text()).not.toContain('Obsolete field')
    expect(model.value.templateShapeChanged).toBe(false)
    if (identity !== 'credential') {
      replacement.resolve(json({ templateShapeChanged: false, fieldCatalog: [field('Replacement')] }))
      await flushPromises()
      expect(wrapper.text()).toContain('Replacement field')
    }
    wrapper.unmount()
  })

})
