import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { authorizeGcFormsStream } from '../runtime.ts'
import { listClaimMaterializationFailures } from '../materialization-failures.ts'

export default defineGcsExtensionRouteHandler(async (context) => {
  const { params } = context
  const streamId = params.streamId ?? ''
  await authorizeGcFormsStream(context, streamId, 'read')

  return await listClaimMaterializationFailures(context, streamId)
})
