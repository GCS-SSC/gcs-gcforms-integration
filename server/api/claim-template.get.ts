import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { generateGcFormsClaimTemplate } from '../claim-template'
import { authorizeGcFormsStream } from '../runtime'

export default defineGcsExtensionRouteHandler(async (context) => {
  const { params, db } = context
  const streamId = params.streamId ?? ''
  await authorizeGcFormsStream(context, streamId, 'read')

  return await generateGcFormsClaimTemplate(db, streamId)
})
