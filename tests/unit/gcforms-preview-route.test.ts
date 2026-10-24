import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import type { GcsExtensionRouteEvent } from '@gcs-ssc/extensions/server'
import { createEvent } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authorizeGcFormsStreamMock = vi.fn()

vi.mock('../../server/runtime', () => ({
  authorizeGcFormsStream: (...args: unknown[]) => authorizeGcFormsStreamMock(...args)
}))

const createPreviewEvent = (body: unknown): GcsExtensionRouteEvent => {
  const request = new IncomingMessage(new Socket())
  const json = JSON.stringify(body)
  request.method = 'POST'
  request.headers = {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(json)),
    'accept-language': 'fr-CA'
  }
  request.push(json)
  request.push(null)
  const event = createEvent(request, new ServerResponse(request))
  event.context.$db = {}
  event.context.params = { streamId: 'stream-1' }
  return event
}

describe('GC Forms preview route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    authorizeGcFormsStreamMock.mockResolvedValue(undefined)
  })

  it('authorizes stream updates and previews string answers against configured mappings', async () => {
    const event = createPreviewEvent({
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
    const event = createPreviewEvent({
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

    const result = await handler(event)

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      values: [],
      issues: [expect.objectContaining({
        mappingId: 'map-name',
        code: 'missing_required_value',
        params: { destinationPath: 'egcs_fc_title_en' },
        message: 'Une valeur Formulaires GC obligatoire est manquante pour egcs_fc_title_en.'
      })]
    }))
  })
})
