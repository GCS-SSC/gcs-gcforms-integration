/* eslint-disable jsdoc/require-jsdoc -- executable extension-owned browser regression helpers */
import { randomInt } from 'node:crypto'
import { nanoid } from 'nanoid'
import { expect, test, type APIResponse, type Page } from '@playwright/test'

type Fixture = { agencyId: string; transferPaymentId: string; streamId: string }

type PresentationCell = {
  claimChild: string
  claimGroup: string
  collapseLabel: string
  configurationPath: '/config' | '/configuration'
  localeId: 'LOC-EN' | 'LOC-FR'
  otherGroupChild: string
  pathPrefix: '/en' | '/fr'
  viewport: { width: number, height: number }
  viewportId: 'VP-DESKTOP' | 'VP-MOBILE'
  expandLabel: string
}

const presentationCells: PresentationCell[] = [
  {
    claimChild: 'Numero d entente',
    claimGroup: 'Champs de reclamation',
    collapseLabel: 'Reduire',
    configurationPath: '/configuration',
    expandLabel: 'Developper',
    localeId: 'LOC-FR',
    otherGroupChild: 'Categorie de cout',
    pathPrefix: '/fr',
    viewport: { width: 1440, height: 900 },
    viewportId: 'VP-DESKTOP'
  },
  {
    claimChild: 'Numero d entente',
    claimGroup: 'Champs de reclamation',
    collapseLabel: 'Reduire',
    configurationPath: '/configuration',
    expandLabel: 'Developper',
    localeId: 'LOC-FR',
    otherGroupChild: 'Categorie de cout',
    pathPrefix: '/fr',
    viewport: { width: 390, height: 844 },
    viewportId: 'VP-MOBILE'
  },
  {
    claimChild: 'Agreement number',
    claimGroup: 'Claim fields',
    collapseLabel: 'Collapse',
    configurationPath: '/config',
    expandLabel: 'Expand',
    localeId: 'LOC-EN',
    otherGroupChild: 'Cost category',
    pathPrefix: '/en',
    viewport: { width: 390, height: 844 },
    viewportId: 'VP-MOBILE'
  },
  {
    claimChild: 'Agreement number',
    claimGroup: 'Claim fields',
    collapseLabel: 'Collapse',
    configurationPath: '/config',
    expandLabel: 'Expand',
    localeId: 'LOC-EN',
    otherGroupChild: 'Cost category',
    pathPrefix: '/en',
    viewport: { width: 1440, height: 900 },
    viewportId: 'VP-DESKTOP'
  }
]

const expectOk = async (response: APIResponse, label: string): Promise<void> => {
  expect(response.status(), `${label}: ${await response.text()}`).toBeGreaterThanOrEqual(200)
  expect(response.status(), label).toBeLessThan(300)
}

const responseId = async (response: APIResponse): Promise<string> =>
  String(((await response.json()) as { id: string | number }).id)

const login = async (page: Page): Promise<void> => {
  await page.goto('/en/login')
  await page.getByLabel('Email').fill('root@example.com')
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: /^(login|connexion)$/i }).click()
  await page.waitForURL(url => !url.pathname.endsWith('/login'))
}

const createFixture = async (page: Page, fixture: Partial<Fixture>): Promise<Fixture> => {
  const token = nanoid()
  const agency = await page.request.post('/api/agency', { data: {
    egcs_ay_gwcoa_number: '100',
    egcs_ay_agencyfinancialsystemid: `${Date.now()}${randomInt(100_000, 1_000_000)}`,
    egcs_ay_name_en: `GC Forms grouping ${token}`,
    egcs_ay_name_fr: `Regroupement GC Forms ${token}`,
    egcs_ay_abbreviation_en: `GFG-${token.slice(0, 8)}`,
    egcs_ay_abbreviation_fr: `RGF-${token.slice(0, 8)}`,
    egcs_ay_active: true
  } })
  await expectOk(agency, 'Create disposable agency')
  const agencyId = await responseId(agency)
  fixture.agencyId = agencyId
  const statuses = await page.request.get(`/api/agency/${agencyId}/statuses`)
  await expectOk(statuses, 'Read disposable agency statuses')
  const draftStatus = ((await statuses.json()) as Array<{ id: string | number, isDraft: boolean }>).find(status => status.isDraft)
  expect(draftStatus).toBeTruthy()

  const transferPayment = await page.request.post('/api/transfer-payments', { data: {
    egcs_tp_agency: agencyId,
    egcs_tp_datestart: '2026-04-01',
    egcs_tp_dateend: '2026-12-31',
    egcs_tp_name_en: `GC Forms grouping program ${token}`,
    egcs_tp_name_fr: `Programme de regroupement GC Forms ${token}`,
    egcs_tp_abbreviation_en: `GFP-${token.slice(0, 8)}`,
    egcs_tp_abbreviation_fr: `PGF-${token.slice(0, 8)}`,
    egcs_tp_description_en: 'Disposable GC Forms grouping fixture.',
    egcs_tp_description_fr: 'Donnee jetable de regroupement GC Forms.',
    egcs_tp_purpose_en: 'Browser regression coverage',
    egcs_tp_purpose_fr: 'Couverture de regression navigateur',
    egcs_tp_tclink: 'https://example.com/gcforms-grouping',
    egcs_tp_active: true
  } })
  await expectOk(transferPayment, 'Create disposable transfer payment')
  const transferPaymentId = await responseId(transferPayment)
  fixture.transferPaymentId = transferPaymentId

  const stream = await page.request.post(`/api/transfer-payments/${transferPaymentId}/streams`, { data: {
    egcs_tp_name_en: `GC Forms grouping stream ${token}`,
    egcs_tp_name_fr: `Volet de regroupement GC Forms ${token}`,
    egcs_tp_description_en: 'Disposable grouped mapping stream.',
    egcs_tp_description_fr: 'Volet jetable de correspondances regroupees.',
    egcs_tp_abbreviation_en: `GFS-${token.slice(0, 8)}`,
    egcs_tp_abbreviation_fr: `VGF-${token.slice(0, 8)}`,
    egcs_tp_objective_en: 'Exercise grouped mappings.',
    egcs_tp_objective_fr: 'Exercer les correspondances regroupees.',
    egcs_tp_active: true
  } })
  await expectOk(stream, 'Create disposable stream')
  const streamId = await responseId(stream)
  fixture.streamId = streamId

  for (const [path, data] of [
    [`/api/extensions/agency/${agencyId}`, { extensionKey: 'gcs-gcforms-integration', enabled: true, config: { submissionStatusId: String(draftStatus!.id) } }],
    [`/api/extensions/streams/${streamId}`, { extensionKey: 'gcs-gcforms-integration', enabled: true, config: {} }]
  ] as const) {
    const response = await page.request.patch(path, { data })
    await expectOk(response, `Enable GC Forms at ${path}`)
  }
  return { agencyId, transferPaymentId, streamId }
}

const cleanupFixture = async (page: Page, fixture: Partial<Fixture>): Promise<void> => {
  const paths = [
    fixture.transferPaymentId && fixture.streamId
      ? `/api/transfer-payments/${fixture.transferPaymentId}/streams/${fixture.streamId}`
      : null,
    fixture.transferPaymentId ? `/api/transfer-payments/${fixture.transferPaymentId}` : null,
    fixture.agencyId ? `/api/agency/${fixture.agencyId}` : null
  ].filter((path): path is string => path !== null)
  for (const path of paths) {
    const response = await page.request.delete(path)
    expect([200, 404], `Clean up ${path}: ${await response.text()}`).toContain(response.status())
  }
}

test('keeps GC Forms mapping groups controlled by the host table runtime', async ({ page }) => {
  await login(page)
  const fixtureState: Partial<Fixture> = {}
  try {
    const fixture = await createFixture(page, fixtureState)
    const query = new URLSearchParams({
      streamId: fixture.streamId,
      transferPaymentId: fixture.transferPaymentId,
      agencyId: fixture.agencyId
    })
    for (const cell of presentationCells) {
      await page.setViewportSize(cell.viewport)
      await page.goto(`${cell.pathPrefix}/extension/gcs-gcforms-integration${cell.configurationPath}?${query.toString()}`)

      const claimChild = page.getByText(cell.claimChild, { exact: true })
      const otherGroupChild = page.getByText(cell.otherGroupChild, { exact: true })
      const collapseClaimFields = page.getByRole('button', { name: cell.collapseLabel, exact: true })
        .filter({ hasText: cell.claimGroup })
      const expandClaimFields = page.getByRole('button', { name: cell.expandLabel, exact: true })
        .filter({ hasText: cell.claimGroup })

      await expect(collapseClaimFields).toHaveCount(1)
      await expect(claimChild).toBeVisible()
      await expect(otherGroupChild).toBeVisible()
      await collapseClaimFields.click()
      await expect(expandClaimFields).toHaveCount(1)
      await expect(claimChild).toBeHidden()
      await expect(otherGroupChild).toBeVisible()

      const otherGroupRow = page.getByRole('row').filter({ hasText: cell.otherGroupChild })
      await otherGroupRow.getByRole('combobox').click()
      await page.getByRole('option', { name: 'submitted_cost_subsection', exact: true }).click()
      await expect(expandClaimFields).toHaveCount(1)
      await expect(claimChild).toBeHidden()
      await expect(otherGroupChild).toBeVisible()

      await expandClaimFields.click()
      await expect(collapseClaimFields).toHaveCount(1)
      await expect(claimChild).toBeVisible()
      await expect(otherGroupChild).toBeVisible()
    }
  } finally {
    await cleanupFixture(page, fixtureState)
  }
})

test('renders a French materialization diagnostic and retries without leaking raw API text', async ({ page }) => {
  await login(page)
  const fixtureState: Partial<Fixture> = {}
  try {
    const fixture = await createFixture(page, fixtureState)
    const rawDetail = 'SQLSTATE 23505 secret@example.test'
    const localizedDiagnostic = 'L’entente pour claim.egcs_fc_fundingagreement est introuvable dans ce volet de paiements de transfert.'
    const diagnosticRequestLocales: string[] = []
    let retryResolved = false
    await page.route(
      `**/api/extensions/gcs-gcforms-integration/streams/${fixture.streamId}/materialization-failures**`,
      async (route) => {
        const request = route.request()
        diagnosticRequestLocales.push(request.headers()['accept-language'] ?? '')
        if (request.method() === 'POST') {
          retryResolved = true
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, status: 'imported' })
          })
          return
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: retryResolved
              ? []
              : [{
                  submissionId: 'browser-submission-fr',
                  submissionName: 'Réclamation française',
                  agreementNumber: 'AGR-INTROUVABLE',
                  selectedAgreementId: '101',
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
            agreements: [{ id: '101', agreementNumber: 'AGR-001', label: 'AGR-001' }]
          })
        })
      }
    )
    const query = new URLSearchParams({
      streamId: fixture.streamId,
      transferPaymentId: fixture.transferPaymentId,
      agencyId: fixture.agencyId
    })
    await page.goto(`/fr/extension/gcs-gcforms-integration/configuration?${query.toString()}`)
    await page.getByText('Materialisations echouees', { exact: true }).click()

    await expect(page.getByText(localizedDiagnostic, { exact: true }).first()).toBeVisible()
    await expect(page.getByText(rawDetail, { exact: false })).toHaveCount(0)
    await expect(page.getByText('could not be found', { exact: false })).toHaveCount(0)

    const matchButtons = page.getByRole('button', { name: 'Associer', exact: true })
    await expect(matchButtons).toHaveCount(1)
    await matchButtons.first().click()
    await expect(page.getByText(/Associer la soumission: Réclamation française/)).toBeVisible()
    await page.getByRole('button', { name: 'Associer', exact: true }).last().click()

    await expect(page.getByText(
      'Aucune materialisation de reclamation echouee ne necessite de verification.',
      { exact: true }
    )).toBeVisible()
    expect(retryResolved).toBe(true)
    expect(diagnosticRequestLocales.length).toBeGreaterThanOrEqual(3)
    expect(diagnosticRequestLocales.every(locale => locale === 'fr')).toBe(true)
  } finally {
    await cleanupFixture(page, fixtureState)
  }
})
