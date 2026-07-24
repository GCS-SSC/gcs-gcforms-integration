import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { authorizeGcFormsStream, syncStream } from '../runtime'

export default defineGcsExtensionRouteHandler(async (context) => {
  const { params, db } = context
  const streamId = params.streamId ?? ''
  await authorizeGcFormsStream(context, streamId, 'update')

  const result = await syncStream(db, streamId)

  return {
    ok: true,
    ...result
  }
})
