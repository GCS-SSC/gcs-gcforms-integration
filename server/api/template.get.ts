/* eslint-disable jsdoc/require-jsdoc */
import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { authorizeGcFormsStream, getStoredTemplate } from '../runtime'

export default defineGcsExtensionRouteHandler(async (context) => {
  const { params, db } = context
  const streamId = params.streamId ?? ''
  await authorizeGcFormsStream(context, streamId, 'read')

  return await getStoredTemplate(db, streamId)
})
