import type { ExtensionEntityTabContext } from '@gcs-ssc/extensions'

export const buildGcFormsEntitySourceEndpoint = (
  context: ExtensionEntityTabContext
): string => {
  if (context.target === 'proponent' && context.applicantRecipientId) {
    return `/proponents/${context.applicantRecipientId}/submissions`
  }

  if (context.target === 'claim' && context.claimId) {
    return `/claims/${context.claimId}/submissions`
  }

  if (context.target === 'monitor' && context.monitorId) {
    return `/monitors/${context.monitorId}/submissions`
  }

  return ''
}
