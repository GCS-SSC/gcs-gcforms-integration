// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { installExtensionTestUiRuntime } from '@gcs-ssc/extensions/testing'
import GcFormsEntitySourceTab from '../../components/GcFormsEntitySourceTab.vue'

const longMappedValue = `LONG-${'x'.repeat(320)}`

const jsonResponse = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
  status,
  headers: {
    'content-type': 'application/json'
  }
})

const componentProps = {
  extensionKey: 'gcs-gcforms-integration',
  context: {
    target: 'proponent',
    applicantRecipientId: '42'
  },
  config: {},
  rbac: {
    subject: 'applicant_recipient',
    action: 'read'
  }
} as never

const mountTab = async (
  localeId: 'en' | 'fr',
  fetchImplementation: typeof fetch
): Promise<VueWrapper> => {
  vi.stubGlobal('useI18n', () => ({
    locale: ref(localeId),
    t: (key: string) => key,
    n: (value: number) => String(value)
  }))
  installExtensionTestUiRuntime()
  vi.stubGlobal('fetch', fetchImplementation)

  const wrapper = mount(GcFormsEntitySourceTab, {
    props: componentProps
  })
  await flushPromises()
  return wrapper
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  installExtensionTestUiRuntime()
})

describe('GcFormsEntitySourceTab', () => {
  it.each([
    {
      localeId: 'en' as const,
      title: 'GC Forms source data',
      status: 'Imported; confirmation pending',
      received: new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium' })
        .format(new Date('2026-01-15T17:30:00.000Z')),
      mappedHeader: 'Mapped values'
    },
    {
      localeId: 'fr' as const,
      title: 'Données sources de GC Forms',
      status: 'Importée; confirmation en attente',
      received: new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium' })
        .format(new Date('2026-01-15T17:30:00.000Z')),
      mappedHeader: 'Valeurs mises en correspondance'
    }
  ])('renders localized structured populated data in $localeId', async ({
    localeId,
    title,
    status,
    received,
    mappedHeader
  }) => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({
      items: [{
        id: 'submission-1',
        submission_name: 'submission-alpha',
        status: 'imported_pending_confirm',
        gcforms_created_at: '2026-01-15T17:30:00.000Z',
        mapped_values: [
          {
            mappingId: 'agreement-number',
            sourceQuestionId: 'question-1',
            destinationEntity: 'fundingcaseagreement',
            destinationPath: 'agreement.number',
            value: longMappedValue
          },
          {
            mappingId: 'claim-details',
            sourceQuestionId: 'question-2',
            destinationEntity: 'fundingcaseagreementclaim',
            destinationPath: 'claim.details',
            value: {
              reference: 'REF-2026-001',
              approved: true,
              amounts: [1234.5, null]
            }
          }
        ]
      }]
    }))
    const wrapper = await mountTab(localeId, fetchMock)
    const text = wrapper.text()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/extensions/gcs-gcforms-integration/proponents/42/submissions',
      expect.objectContaining({ method: 'GET' })
    )
    expect(text).toContain(title)
    expect(text).toContain(mappedHeader)
    expect(text).toContain(status)
    expect(text).toContain(received)
    expect(text).toContain('agreement.number')
    expect(text).toContain('claim.details.reference')
    expect(text).toContain('claim.details.approved')
    expect(text).toContain('claim.details.amounts[1]')
    expect(text).toContain(longMappedValue)
    expect(text).not.toContain('imported_pending_confirm')
    expect(text).not.toContain('2026-01-15T17:30:00.000Z')
    expect(text).not.toContain('"destinationPath"')
    expect(wrapper.get('[data-testid="gcforms-table-scroll"]').classes()).toContain('overflow-x-auto')
    expect(wrapper.get('.gcforms-mapped-values-scroll').classes()).toContain('overflow-x-auto')
    wrapper.unmount()
  })

  it('renders the corrected French true-empty state without an error alert', async () => {
    const wrapper = await mountTab('fr', vi.fn<typeof fetch>(async () => jsonResponse({ items: [] })))

    expect(wrapper.get('[data-testid="gcforms-empty-state"]').text())
      .toBe('Aucune soumission de GC Forms n’est encore liée à cet enregistrement.')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Réessayer')
    wrapper.unmount()
  })

  it('keeps a localized French 403 error durable and retries into the true-empty state', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: { message: 'Interdit' } }, 403))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
    const wrapper = await mountTab('fr', fetchMock)
    const alert = wrapper.get('[role="alert"]')

    expect(alert.text()).toContain('Impossible de charger les données sources de GC Forms.')
    expect(alert.text()).toContain(
      'Vous n’avez pas l’autorisation de consulter les données sources de GC Forms pour cet enregistrement.'
    )
    expect(alert.text()).not.toContain('Aucune soumission')
    expect(alert.text()).not.toContain('403')
    expect(wrapper.find('[data-testid="gcforms-empty-state"]').exists()).toBe(false)

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="gcforms-empty-state"]').text())
      .toBe('Aucune soumission de GC Forms n’est encore liée à cet enregistrement.')
    wrapper.unmount()
  })

  it('renders a durable localized English 500 error with Retry instead of the empty state', async () => {
    const wrapper = await mountTab('en', vi.fn<typeof fetch>(async () =>
      jsonResponse({ data: { message: 'Internal failure' } }, 500)))
    const alert = wrapper.get('[role="alert"]')

    expect(alert.text()).toContain('GC Forms source data could not be loaded.')
    expect(alert.text()).toContain('An error occurred while loading GC Forms source data.')
    expect(alert.text()).toContain('Retry')
    expect(alert.text()).not.toContain('No GC Forms submissions')
    expect(alert.text()).not.toContain('500')
    expect(wrapper.find('[data-testid="gcforms-empty-state"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
