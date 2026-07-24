import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { authorizeGcFormsStream } from '../runtime'
import { listClaimMaterializationFailures } from '../materialization-failures'

export default defineGcsExtensionRouteHandler(async (context) => {
  const { params, db } = context
  const streamId = params.streamId ?? ''
  await authorizeGcFormsStream(context, streamId, 'read')

  return await listClaimMaterializationFailures(db, streamId)
})
