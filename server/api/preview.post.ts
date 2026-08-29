import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { normalizeGcFormsAnswers, parseGcFormsStreamConfig, previewGcFormsMapping } from '../../shared/gcforms.ts'
import { getGcFormsDiagnosticLocale, renderStoredGcFormsMappingIssues } from '../diagnostics.ts'
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
  const preview = previewGcFormsMapping(answers, config.mappings)

  return {
    ok: true,
    values: preview.values,
    issues: renderStoredGcFormsMappingIssues(preview.issues, getGcFormsDiagnosticLocale(context))
  }
})
