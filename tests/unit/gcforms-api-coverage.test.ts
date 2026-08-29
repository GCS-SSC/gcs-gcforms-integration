import { beforeEach, describe, expect, it, vi } from 'vitest'

const authorizeMock = vi.hoisted(() => vi.fn())
const credentialMocks = vi.hoisted(() => ({
  create: vi.fn(), list: vi.fn(), patch: vi.fn(), remove: vi.fn()
}))
const runtimeMocks = vi.hoisted(() => ({
  findConnection: vi.fn(),
  getConfig: vi.fn(),
  getStoredTemplate: vi.fn(),
  persistShapeChange: vi.fn(),
  reconcile: vi.fn(),
  refreshTemplate: vi.fn(),
  runWrite: vi.fn(),
  sync: vi.fn()
}))
const materializationMocks = vi.hoisted(() => ({ list: vi.fn(), resolve: vi.fn() }))
const claimTemplateMock = vi.hoisted(() => vi.fn())
const userErrorCheckMock = vi.hoisted(() => vi.fn())

vi.mock('@gcs-ssc/extensions/server', () => ({
  createGcsExtensionUserError: (options: Record<string, unknown>) => Object.assign(new Error(String(options.code)), options),
  defineGcsExtensionRouteHandler: (handler: unknown) => handler,
  isGcsExtensionUserError: (...args: unknown[]) => userErrorCheckMock(...args)
}))

vi.mock('../../server/credentials.ts', () => ({
  createGcFormsCredential: (...args: unknown[]) => credentialMocks.create(...args),
  listGcFormsCredentials: (...args: unknown[]) => credentialMocks.list(...args),
  patchGcFormsCredential: (...args: unknown[]) => credentialMocks.patch(...args),
  deleteGcFormsCredential: (...args: unknown[]) => credentialMocks.remove(...args)
}))

vi.mock('../../server/runtime.ts', () => ({
  authorizeGcFormsStream: (...args: unknown[]) => authorizeMock(...args),
  findCurrentGcFormsConnection: (...args: unknown[]) => runtimeMocks.findConnection(...args),
  getStreamConfig: (...args: unknown[]) => runtimeMocks.getConfig(...args),
  getStoredTemplate: (...args: unknown[]) => runtimeMocks.getStoredTemplate(...args),
  persistGcFormsTemplateShapeChangedForSession: (...args: unknown[]) => runtimeMocks.persistShapeChange(...args),
  reconcileGcFormsSubmissionConfirmation: (...args: unknown[]) => runtimeMocks.reconcile(...args),
  refreshTemplate: (...args: unknown[]) => runtimeMocks.refreshTemplate(...args),
  runAuthorizedGcFormsWrite: (...args: unknown[]) => runtimeMocks.runWrite(...args),
  syncStream: (...args: unknown[]) => runtimeMocks.sync(...args)
}))

vi.mock('../../server/materialization-failures.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/materialization-failures.ts')>(),
  listClaimMaterializationFailures: (...args: unknown[]) => materializationMocks.list(...args),
  resolveClaimMaterializationFailure: (...args: unknown[]) => materializationMocks.resolve(...args)
}))

vi.mock('../../server/claim-template.ts', () => ({
  generateGcFormsClaimTemplate: (...args: unknown[]) => claimTemplateMock(...args)
}))

vi.mock('../../server/db.ts', () => ({
  asGcFormsIntegrationDb: (db: unknown) => db
}))

import deleteCredential from '../../server/api/agency-credentials.delete'
import getCredentials from '../../server/api/agency-credentials.get'
import patchCredential from '../../server/api/agency-credentials.patch'
import postCredential from '../../server/api/agency-credentials.post'
import getClaimTemplate from '../../server/api/claim-template.get'
import getEntitySubmissions from '../../server/api/entity-submissions.get'
import resolveMaterialization from '../../server/api/materialization-failure-agreement.post'
import getMaterializationFailures from '../../server/api/materialization-failures.get'
import preview from '../../server/api/preview.post'
import getSubmissions from '../../server/api/submissions.get'
import sync from '../../server/api/sync.post'
import getTemplate from '../../server/api/template.get'
import postTemplate from '../../server/api/template.post'

const createQueryDb = (rows: Array<Record<string, unknown>>) => {
  const query = new Proxy({}, {
    get: (_target, property) => property === 'execute'
      ? async () => rows
      : () => query
  })
  return { selectFrom: vi.fn(() => query) }
}

describe('GC Forms route owner coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps credential wrappers owned by the credential module', async () => {
    const context = { marker: true }
    credentialMocks.create.mockResolvedValue('created')
    credentialMocks.list.mockResolvedValue('listed')
    credentialMocks.patch.mockResolvedValue('patched')
    credentialMocks.remove.mockResolvedValue('removed')

    await expect(postCredential(context as never)).resolves.toBe('created')
    await expect(getCredentials(context as never)).resolves.toBe('listed')
    await expect(patchCredential(context as never)).resolves.toBe('patched')
    await expect(deleteCredential(context as never)).resolves.toBe('removed')
  })

  it('authorizes and delegates template and materialization routes with nullish ids', async () => {
    claimTemplateMock.mockResolvedValue({ template: true })
    materializationMocks.list.mockResolvedValue({ items: [] })
    materializationMocks.resolve.mockResolvedValue({ resolved: true })
    runtimeMocks.getStoredTemplate.mockResolvedValue({ stored: true })
    runtimeMocks.runWrite.mockImplementation(async (_context, callback) => await callback('trx'))
    runtimeMocks.refreshTemplate.mockResolvedValue({
      fieldCatalog: [{ id: 'field' }],
      template: { titleEn: undefined, titleFr: 'Titre' }
    })
    const context = {
      params: {},
      db: { marker: true },
      readBody: vi.fn(async () => ({ agreementId: 91 }))
    }

    await expect(getClaimTemplate(context as never)).resolves.toEqual({ template: true })
    await expect(getMaterializationFailures(context as never)).resolves.toEqual({ items: [] })
    await expect(resolveMaterialization(context as never)).resolves.toEqual({ resolved: true })
    await expect(getTemplate(context as never)).resolves.toEqual({ stored: true })
    await expect(postTemplate(context as never)).resolves.toEqual({
      ok: true,
      fieldCatalog: [{ id: 'field' }],
      title: { en: null, fr: 'Titre' }
    })
    expect(authorizeMock).toHaveBeenCalledWith(context, '', 'read')
    expect(authorizeMock).toHaveBeenCalledWith(context, '', 'update')
    expect(materializationMocks.resolve).toHaveBeenCalledWith(context, '', '', '91')
  })

  it('rejects entity submission reads without both resolved owner identifiers', async () => {
    for (const entity of [undefined, { ownerType: 'claim' }, { ownerId: '1' }]) {
      await expect(getEntitySubmissions({ entity, db: {} } as never)).rejects.toMatchObject({
        code: 'GCS_GCFORMS_ENTITY_CONTEXT_MISSING', statusCode: 400
      })
    }
  })

  it('summarizes entity submissions including confirmed and active rows', async () => {
    const rows = [{ status: 'confirmed' }, { status: 'imported' }]
    await expect(getEntitySubmissions({
      entity: { ownerType: 'fundingclaimreconcile', ownerId: '1' },
      db: createQueryDb(rows)
    } as never)).resolves.toMatchObject({
      items: rows,
      total: 2,
      stats: { total: 2, active: 1 },
      page: 1,
      limit: 2
    })
  })

  it.each([
    { answers: '{"question":"answer"}' },
    { answers: { question: 'answer' } },
    { answers: null }
  ])('previews normalized $answers answers', async body => {
    const response = await preview({
      params: { streamId: 'stream-1' },
      readBody: vi.fn(async () => ({ ...body, config: null }))
    } as never)
    expect(response).toMatchObject({ ok: true })
  })

  it('returns no submissions without a current connection and defaults the page size', async () => {
    runtimeMocks.getConfig.mockResolvedValue({})
    runtimeMocks.findConnection.mockResolvedValue(null)
    await expect(getSubmissions({ params: {}, db: createQueryDb([]) } as never)).resolves.toMatchObject({
      items: [], total: 0, stats: { active: 0 }, limit: 10
    })
  })

  it('summarizes submissions from the current connection', async () => {
    const rows = [{ status: 'confirmed' }, { status: 'imported' }]
    runtimeMocks.getConfig.mockResolvedValue({})
    runtimeMocks.findConnection.mockResolvedValue({ id: 'connection-1' })
    await expect(getSubmissions({
      params: { streamId: 'stream-1' }, db: createQueryDb(rows)
    } as never)).resolves.toMatchObject({ total: 2, stats: { active: 1 }, limit: 2 })
  })

  it('reconciles every pending confirmation after a successful sync', async () => {
    runtimeMocks.sync.mockResolvedValue({
      runId: 'run-1', imported: 2, pendingConfirmations: [{ id: '1' }, { id: '2' }]
    })
    await expect(sync({ params: { streamId: 'stream-1' } } as never)).resolves.toEqual({
      ok: true, runId: 'run-1', imported: 2
    })
    expect(runtimeMocks.reconcile).toHaveBeenCalledTimes(2)
  })

  it.each([
    { code: 'GCS_GCFORMS_TEMPLATE_CHANGED', recognized: true, persists: true },
    { code: 'OTHER', recognized: true, persists: false },
    { code: 'OTHER', recognized: false, persists: false }
  ])('preserves sync failure $code after conditional shape persistence', async ({ code, recognized, persists }) => {
    const error = Object.assign(new Error(code), { code })
    userErrorCheckMock.mockReturnValue(recognized)
    runtimeMocks.sync.mockRejectedValue(error)

    await expect(sync({ params: { streamId: 'stream-1' } } as never)).rejects.toBe(error)
    expect(runtimeMocks.persistShapeChange).toHaveBeenCalledTimes(persists ? 1 : 0)
  })
})
