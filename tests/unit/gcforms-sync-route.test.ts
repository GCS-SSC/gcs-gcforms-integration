import { beforeEach, describe, expect, it, vi } from 'vitest'

const authorizeStreamMock = vi.fn(async () => undefined)
const persistTemplateDriftMock = vi.fn(async () => undefined)
const reconcileConfirmationMock = vi.fn(async () => undefined)
const syncStreamMock = vi.fn()

vi.mock('@gcs-ssc/extensions/server', () => ({
  defineGcsExtensionRouteHandler: (handler: unknown) => handler,
  isGcsExtensionUserError: (error: unknown) => Boolean(
    error
    && typeof error === 'object'
    && (error as { name?: string }).name === 'GcsExtensionUserError'
  )
}))

vi.mock('../../server/runtime', () => ({
  authorizeGcFormsStream: (...args: unknown[]) => authorizeStreamMock(...args),
  persistGcFormsTemplateShapeChangedForSession: (...args: unknown[]) => persistTemplateDriftMock(...args),
  reconcileGcFormsSubmissionConfirmation: (...args: unknown[]) => reconcileConfirmationMock(...args),
  syncStream: (...args: unknown[]) => syncStreamMock(...args)
}))

describe('GC Forms sync route transaction phases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lets runtime perform phased synchronization and reconciles every durable marker', async () => {
    const context = {
      params: { streamId: '31' },
      db: {},
      stream: { agencyId: '1' },
      writeAuthorization: {}
    }
    const pendingConfirmations = [
      { submissionId: 'submission-1', remotelyPending: true },
      { submissionId: 'submission-2', remotelyPending: false }
    ]
    syncStreamMock.mockResolvedValue({
      runId: 'run-1',
      discovered: 1,
      imported: 1,
      skipped: 0,
      problems: 0,
      continuationRequired: false,
      pendingConfirmations
    })
    const handler = (await import('../../server/api/sync.post')).default as any

    await expect(handler(context)).resolves.toEqual({
      ok: true,
      runId: 'run-1',
      discovered: 1,
      imported: 1,
      skipped: 0,
      problems: 0,
      continuationRequired: false
    })
    expect(syncStreamMock).toHaveBeenCalledWith(context, '31')
    expect(reconcileConfirmationMock.mock.calls).toEqual([
      [context, '31', pendingConfirmations[0]],
      [context, '31', pendingConfirmations[1]]
    ])
  })

  it('persists template drift in a new authorized transaction after remote preparation fails', async () => {
    const templateChanged = Object.assign(new Error('template changed'), {
      name: 'GcsExtensionUserError',
      code: 'GCS_GCFORMS_TEMPLATE_CHANGED'
    })
    syncStreamMock.mockRejectedValueOnce(templateChanged)
    const handler = (await import('../../server/api/sync.post')).default as any

    const context = {
      params: { streamId: '31' },
      db: {},
      stream: { agencyId: '1' },
      writeAuthorization: {}
    }
    await expect(handler(context)).rejects.toBe(templateChanged)
    expect(persistTemplateDriftMock).toHaveBeenCalledWith(context, '31', templateChanged)
  })

  it('returns renewed-session config drift instead of the stale template error', async () => {
    const templateChanged = Object.assign(new Error('template changed'), {
      name: 'GcsExtensionUserError',
      code: 'GCS_GCFORMS_TEMPLATE_CHANGED'
    })
    const configChanged = Object.assign(new Error('config changed'), {
      name: 'GcsExtensionUserError',
      code: 'GCS_GCFORMS_CONFIG_CHANGED'
    })
    syncStreamMock.mockRejectedValueOnce(templateChanged)
    persistTemplateDriftMock.mockRejectedValueOnce(configChanged)
    const context = {
      params: { streamId: '31' },
      db: {},
      stream: { agencyId: '1' },
      writeAuthorization: {}
    }
    const handler = (await import('../../server/api/sync.post')).default as any

    await expect(handler(context)).rejects.toBe(configChanged)
  })

  it('stops at a failed confirmation so its committed pending marker remains recoverable', async () => {
    const pending = { submissionId: 'submission-1', remotelyPending: true }
    syncStreamMock.mockResolvedValue({
      runId: 'run-1',
      discovered: 1,
      imported: 1,
      skipped: 0,
      problems: 0,
      pendingConfirmations: [pending]
    })
    reconcileConfirmationMock.mockRejectedValueOnce(new Error('remote unavailable'))
    const handler = (await import('../../server/api/sync.post')).default as any
    const context = {
      params: { streamId: '31' },
      db: {},
      stream: { agencyId: '1' },
      writeAuthorization: {}
    }

    await expect(handler(context)).rejects.toThrow('remote unavailable')
    await expect(handler(context)).resolves.toMatchObject({ ok: true })
    expect(reconcileConfirmationMock).toHaveBeenCalledTimes(2)
  })
})
