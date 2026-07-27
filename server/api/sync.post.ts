import { defineGcsExtensionRouteHandler, isGcsExtensionUserError } from '@gcs-ssc/extensions/server'
import {
  authorizeGcFormsStream,
  persistGcFormsTemplateShapeChangedForSession,
  reconcileGcFormsSubmissionConfirmation,
  syncStream
} from '../runtime.ts'

export default defineGcsExtensionRouteHandler(async (context) => {
  const { params } = context
  const streamId = params.streamId ?? ''
  await authorizeGcFormsStream(context, streamId, 'update')

  let syncResult: Awaited<ReturnType<typeof syncStream>>
  try {
    syncResult = await syncStream(context, streamId)
  } catch (error: unknown) {
    if (isGcsExtensionUserError(error) && error.code === 'GCS_GCFORMS_TEMPLATE_CHANGED') {
      await persistGcFormsTemplateShapeChangedForSession(context, streamId, error)
    }
    throw error
  }

  const { pendingConfirmations, ...result } = syncResult
  for (const pending of pendingConfirmations) {
    await reconcileGcFormsSubmissionConfirmation(context, streamId, pending)
  }

  return {
    ok: true,
    ...result
  }
})
