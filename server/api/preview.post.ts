import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { normalizeGcFormsAnswers, parseGcFormsStreamConfig, previewGcFormsMapping } from '../../shared/gcforms.ts'
import { authorizeGcFormsStream } from '../runtime.ts'

export default defineGcsExtensionRouteHandler(async (context) => {
  const { params, readBody } = context
  const streamId = params.streamId ?? ''
  await authorizeGcFormsStream(context, streamId, 'update')

  const body = await readBody<{ answers?: unknown; config?: unknown }>()
  const config = parseGcFormsStreamConfig(body.config ?? {})
  const answers = typeof body.answers === 'string'
    ? normalizeGcFormsAnswers(body.answers)
    : normalizeGcFormsAnswers(body.answers && typeof body.answers === 'object' ? body.answers as Record<string, unknown> : {})

  return {
    ok: true,
    ...previewGcFormsMapping(answers, config.mappings)
  }
})
