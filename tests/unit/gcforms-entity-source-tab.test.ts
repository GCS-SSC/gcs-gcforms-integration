import { describe, expect, it } from 'vitest'
import { buildGcFormsEntitySourceEndpoint } from '../../components/gcforms-entity-source-tab'

describe('GC Forms entity source tab helpers', () => {
  it.each([
    [
      'agreement',
      { target: 'agreement', agreementId: 'agreement-1' },
      '/agreements/agreement-1/submissions'
    ],
    [
      'proponent',
      { target: 'proponent', applicantRecipientId: 'recipient-1' },
      '/proponents/recipient-1/submissions'
    ],
    [
      'claim',
      { target: 'claim', claimId: 'claim-1' },
      '/claims/claim-1/submissions'
    ],
    [
      'monitor',
      { target: 'monitor', monitorId: 'monitor-1' },
      '/monitors/monitor-1/submissions'
    ]
  ])('builds the %s submissions endpoint', (_label, context, expected) => {
    expect(buildGcFormsEntitySourceEndpoint(context as never)).toBe(expected)
  })

  it('returns an empty endpoint when the target id is unavailable', () => {
    expect(buildGcFormsEntitySourceEndpoint({
      target: 'agreement'
    } as never)).toBe('')
  })
})
