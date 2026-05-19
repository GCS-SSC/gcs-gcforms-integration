import { beforeEach, describe, expect, it, vi } from 'vitest'

const authorizeGcFormsStreamMock = vi.fn()
const generateGcFormsClaimTemplateMock = vi.fn()

vi.mock('../../server/runtime', () => ({
  authorizeGcFormsStream: (...args: unknown[]) => authorizeGcFormsStreamMock(...args)
}))

vi.mock('../../server/claim-template', () => ({
  generateGcFormsClaimTemplate: (...args: unknown[]) => generateGcFormsClaimTemplateMock(...args)
}))

describe('GC Forms claim template route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    authorizeGcFormsStreamMock.mockResolvedValue(undefined)
    generateGcFormsClaimTemplateMock.mockResolvedValue({ elements: [] })
  })

  it('authorizes stream reads and returns the generated claim template', async () => {
    const handler = (await import('../../server/api/claim-template.get')).default
    const event = { context: { $db: {}, params: { streamId: 'stream-1' } } } as never

    const result = await handler(event)

    expect(authorizeGcFormsStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { streamId: 'stream-1' },
        db: {}
      }),
      'stream-1',
      'read'
    )
    expect(generateGcFormsClaimTemplateMock).toHaveBeenCalledWith({}, 'stream-1')
    expect(result).toEqual({ elements: [] })
  })
})
