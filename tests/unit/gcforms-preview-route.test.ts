import { beforeEach, describe, expect, it, vi } from 'vitest'

const readBodyMock = vi.fn()
const authorizeGcFormsStreamMock = vi.fn()

vi.mock('h3', () => ({
  isEvent: () => true,
  getHeader: (_event: unknown, name: string) => name === 'accept-language' ? 'fr-CA' : undefined,
  readBody: (...args: unknown[]) => readBodyMock(...args)
}))

vi.mock('../../server/runtime', () => ({
  authorizeGcFormsStream: (...args: unknown[]) => authorizeGcFormsStreamMock(...args)
}))

describe('GC Forms preview route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    authorizeGcFormsStreamMock.mockResolvedValue(undefined)
  })

  it('authorizes stream updates and previews string answers against configured mappings', async () => {
    readBodyMock.mockResolvedValueOnce({
      answers: JSON.stringify({ amount: '1,234.56' }),
      config: {
        mappings: [{
          id: 'map-amount',
          sourceQuestionId: 'amount',
          destinationEntity: 'claim',
          destinationPath: 'egcs_fc_paymentamount',
          transform: 'money',
          required: true,
          onMissing: 'block',
          onInvalid: 'block'
        }]
      }
    })
    const handler = (await import('../../server/api/preview.post')).default
    const event = { context: { $db: {}, params: { streamId: 'stream-1' } } } as never

    const result = await handler(event)

    expect(authorizeGcFormsStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { streamId: 'stream-1' },
        db: {}
      }),
      'stream-1',
      'update'
    )
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      values: [expect.objectContaining({
        mappingId: 'map-amount',
        value: '1234.56'
      })],
      issues: []
    }))
  })

  it('normalizes object answers and reports missing required preview values', async () => {
    readBodyMock.mockResolvedValueOnce({
      answers: {},
      config: {
        mappings: [{
          id: 'map-name',
          sourceQuestionId: 'name',
          destinationEntity: 'agreement',
          destinationPath: 'egcs_fc_title_en',
          transform: 'string',
          required: true,
          onMissing: 'block',
          onInvalid: 'block'
        }]
      }
    })
    const handler = (await import('../../server/api/preview.post')).default

    const result = await handler({ context: { $db: {}, params: { streamId: 'stream-1' } } } as never)

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      values: [],
      issues: [expect.objectContaining({
        mappingId: 'map-name',
        code: 'missing_required_value',
        params: { destinationPath: 'egcs_fc_title_en' },
        message: 'Une valeur GC Forms obligatoire est manquante pour egcs_fc_title_en.'
      })]
    }))
  })
})
