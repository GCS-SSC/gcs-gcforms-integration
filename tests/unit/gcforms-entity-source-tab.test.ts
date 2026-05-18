import { describe, expect, it } from 'vitest'
import { buildGcFormsEntitySourceEndpoint } from '../../components/gcforms-entity-source-tab'

describe('GC Forms entity source tab helpers', () => {
  it.each([
    [
      'agreement',
      { target: 'agreement', agreementId: 'agreement-1' },
      '/api/extensions/gcs-gcforms-integration/agreements/agreement-1/submissions'
    ],
    [
      'proponent',
      { target: 'proponent', applicantRecipientId: 'recipient-1' },
      '/api/extensions/gcs-gcforms-integration/proponents/recipient-1/submissions'
    ],
    [
      'claim',
      { target: 'claim', claimId: 'claim-1' },
      '/api/extensions/gcs-gcforms-integration/claims/claim-1/submissions'
    ],
    [
      'monitor',
      { target: 'monitor', monitorId: 'monitor-1' },
      '/api/extensions/gcs-gcforms-integration/monitors/monitor-1/submissions'
    ]
  ])('builds the %s submissions endpoint', (_label, context, expected) => {
    expect(buildGcFormsEntitySourceEndpoint('gcs-gcforms-integration', context as never)).toBe(expected)
  })

  it('returns an empty endpoint when the target id is unavailable', () => {
    expect(buildGcFormsEntitySourceEndpoint('gcs-gcforms-integration', {
      target: 'agreement'
    } as never)).toBe('')
  })
})
