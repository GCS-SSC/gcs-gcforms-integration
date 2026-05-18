import type { ExtensionEntityTabContext } from '@gcs-ssc/extensions/server'

export const buildGcFormsEntitySourceEndpoint = (
  extensionKey: string,
  context: ExtensionEntityTabContext
): string => {
  if (context.target === 'agreement' && context.agreementId) {
    return `/api/extensions/${extensionKey}/agreements/${context.agreementId}/submissions`
  }

  if (context.target === 'proponent' && context.applicantRecipientId) {
    return `/api/extensions/${extensionKey}/proponents/${context.applicantRecipientId}/submissions`
  }

  if (context.target === 'claim' && context.claimId) {
    return `/api/extensions/${extensionKey}/claims/${context.claimId}/submissions`
  }

  if (context.target === 'monitor' && context.monitorId) {
    return `/api/extensions/${extensionKey}/monitors/${context.monitorId}/submissions`
  }

  return ''
}
