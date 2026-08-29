/* eslint-disable jsdoc/require-jsdoc -- executable extension-owned browser regression helpers */
import { expect, test, type APIResponse, type Page } from '@playwright/test'

type ExtensionState = {
  config: Record<string, unknown>
  enabled: boolean
  extensionKey: string
}

type AgencyExtensionRegistry = {
  items: Array<{
    config?: Record<string, unknown> | null
    enabled: boolean
    extension: { key: string }
  }>
}

const extensionKey = 'gcs-gcforms-integration'
const proponentId = '1'
const sourceApiPattern = `**/api/extensions/${extensionKey}/proponents/${proponentId}/submissions`
const longMappedValue = `LONG-${'x'.repeat(720)}`

const expectOk = async (response: APIResponse, label: string): Promise<void> => {
  expect(response.status(), `${label}: ${await response.text()}`).toBeGreaterThanOrEqual(200)
  expect(response.status(), label).toBeLessThan(300)
}

const login = async (page: Page): Promise<void> => {
  await page.goto('/en/login')
  await page.getByLabel('Email').fill('root@example.com')
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: /^(login|connexion)$/i }).click()
  await page.waitForURL(url => !url.pathname.endsWith('/login'))
}

const getLeadAgencyId = async (page: Page): Promise<string> => {
  const response = await page.request.get(`/api/applicant-recipients/${proponentId}`)
  await expectOk(response, 'Read seeded Proponent')
  const profile = await response.json() as { egcs_ar_leadagency: string | number }
  return String(profile.egcs_ar_leadagency)
}

const readExtensionState = async (page: Page, agencyId: string): Promise<ExtensionState> => {
  const response = await page.request.get(`/api/extensions/agency/${agencyId}?page=1&limit=100`)
  await expectOk(response, 'Read Agency extension state')
  const registry = await response.json() as AgencyExtensionRegistry
  const item = registry.items.find(candidate => candidate.extension.key === extensionKey)
  expect(item, 'GC Forms must be installed in the managed host.').toBeTruthy()
  if (!item) throw new Error('GC Forms is not installed in the managed host.')

  return {
    config: item.config ?? {},
    enabled: item.enabled,
    extensionKey
  }
}

const patchExtensionState = async (
  page: Page,
  agencyId: string,
  state: ExtensionState
): Promise<void> => {
  const response = await page.request.patch(`/api/extensions/agency/${agencyId}`, {
    data: state
  })
  await expectOk(response, `${state.enabled ? 'Enable' : 'Restore'} GC Forms extension state`)
}

const sourceTabPath = (localeId: 'en' | 'fr'): string => {
  return localeId === 'fr'
    ? `/fr/promoteurs/modifier/${proponentId}`
    : `/en/proponents/edit/${proponentId}`
}

const openSourceTab = async (
  page: Page,
  localeId: 'en' | 'fr',
  viewport: { width: number, height: number }
): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(sourceTabPath(localeId))
  const sourceTab = page.getByRole('tab', { name: 'GC Forms', exact: true })
  await expect(sourceTab).toBeVisible()
  await sourceTab.click()
  await expect(page.getByRole('heading', {
    level: 2,
    name: localeId === 'fr' ? 'Données sources de GC Forms' : 'GC Forms source data'
  })).toBeVisible()
  await page.setViewportSize(viewport)
}

const expectNoDocumentOverflow = async (page: Page): Promise<void> => {
  const widths = await page.evaluate(() => ({
    bodyClient: document.body.clientWidth,
    bodyScroll: document.body.scrollWidth,
    documentClient: document.documentElement.clientWidth,
    documentScroll: document.documentElement.scrollWidth
  }))
  expect(widths.bodyScroll).toBeLessThanOrEqual(widths.bodyClient + 1)
  expect(widths.documentScroll).toBeLessThanOrEqual(widths.documentClient + 1)
}

const expectLocalOverflow = async (locator: ReturnType<Page['locator']>): Promise<void> => {
  const widths = await locator.evaluate(element => ({
    client: element.clientWidth,
    scroll: element.scrollWidth
  }))
  expect(widths.scroll).toBeGreaterThan(widths.client)
}

const populatedPayload = {
  items: [{
    id: 'submission-browser-1',
    submission_name: 'submission-browser-long',
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
}

test('renders GC Forms source data, empty, error, retry, and overflow states', async ({ page }) => {
  test.setTimeout(120_000)
  await login(page)
  const agencyId = await getLeadAgencyId(page)
  const initialState = await readExtensionState(page, agencyId)

  try {
    await patchExtensionState(page, agencyId, { ...initialState, enabled: true })

    for (const [name, viewport] of [
      ['desktop', { width: 1440, height: 900 }],
      ['mobile', { width: 390, height: 844 }]
    ] as const) {
      await test.step(`renders long structured English data on ${name}`, async () => {
        await page.route(sourceApiPattern, async route => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(populatedPayload)
          })
        })
        await openSourceTab(page, 'en', viewport)

        const sourceSection = page.getByRole('heading', { name: 'GC Forms source data' }).locator('..').locator('..')
        await expect(page.getByText('Imported; confirmation pending', { exact: true })).toBeVisible()
        await expect(page.getByText('agreement.number', { exact: true })).toBeVisible()
        await expect(page.getByText('claim.details.reference', { exact: true })).toBeVisible()
        await expect(sourceSection).toContainText(longMappedValue)
        await expect(sourceSection).not.toContainText('imported_pending_confirm')
        await expect(sourceSection).not.toContainText('2026-01-15T17:30:00.000Z')
        await expect(sourceSection).not.toContainText('"destinationPath"')
        await expectLocalOverflow(page.locator('.gcforms-mapped-values-scroll'))
        if (name === 'mobile') {
          await expectLocalOverflow(page.getByTestId('gcforms-table-scroll'))
        }
        await expectNoDocumentOverflow(page)
        await page.unroute(sourceApiPattern)
      })
    }

    await test.step('renders corrected French true-empty copy', async () => {
      const viewport = { width: 1440, height: 900 }
      await page.route(sourceApiPattern, async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' })
      })
      await openSourceTab(page, 'fr', viewport)

      await expect(page.getByTestId('gcforms-empty-state'))
        .toHaveText('Aucune soumission de GC Forms n’est encore liée à cet enregistrement.')
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expectNoDocumentOverflow(page)
      await page.unroute(sourceApiPattern)
    })

    await test.step('renders a French mobile 500 error and retries to true-empty', async () => {
      const viewport = { width: 390, height: 844 }
      let requestCount = 0
      await page.route(sourceApiPattern, async route => {
        requestCount += 1
        await route.fulfill(requestCount === 1
          ? {
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({ data: { message: 'Erreur interne' } })
            }
          : {
              status: 200,
              contentType: 'application/json',
              body: '{"items":[]}'
            })
      })
      await openSourceTab(page, 'fr', viewport)

      const alert = page.getByRole('alert')
      await expect(alert).toContainText('Impossible de charger les données sources de GC Forms.')
      await expect(alert).toContainText('Une erreur s’est produite pendant le chargement des données sources de GC Forms.')
      await expect(alert).not.toContainText('Aucune soumission')
      await expect(alert.getByRole('button', { name: 'Réessayer' })).toBeVisible()
      await expectNoDocumentOverflow(page)

      await alert.getByRole('button', { name: 'Réessayer' }).click()
      await expect(page.getByTestId('gcforms-empty-state'))
        .toHaveText('Aucune soumission de GC Forms n’est encore liée à cet enregistrement.')
      expect(requestCount).toBe(2)
      await page.unroute(sourceApiPattern)
    })

    await test.step('renders an English desktop 403 error with Retry instead of empty', async () => {
      const viewport = { width: 1440, height: 900 }
      await page.route(sourceApiPattern, async route => {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ data: { message: 'Forbidden' } })
        })
      })
      await openSourceTab(page, 'en', viewport)

      const alert = page.getByRole('alert')
      await expect(alert).toContainText('GC Forms source data could not be loaded.')
      await expect(alert).toContainText('You do not have permission to view GC Forms source data for this record.')
      await expect(alert).not.toContainText('No GC Forms submissions')
      await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
      await expect(page.getByTestId('gcforms-empty-state')).toHaveCount(0)
      await expectNoDocumentOverflow(page)
      await page.unroute(sourceApiPattern)
    })
  } finally {
    await page.unroute(sourceApiPattern).catch(() => {})
    await patchExtensionState(page, agencyId, initialState)
  }
})
