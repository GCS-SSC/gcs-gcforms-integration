/* eslint-disable jsdoc/require-jsdoc */
import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { normalizeGcFormsAnswers, parseGcFormsStreamConfig, previewGcFormsMapping } from '../../shared/gcforms'
import { authorizeGcFormsStream } from '../runtime'

type ExtensionEvent = H3Event & {
  context: {
    $authContext?: unknown
    $db: unknown
    params?: Record<string, string | undefined>
  }
}

export default async (event: ExtensionEvent) => {
  const streamId = event.context.params?.streamId ?? ''
  await authorizeGcFormsStream(event as never, streamId, 'update')

  const body = await readBody(event) as { answers?: unknown; config?: unknown }
  const config = parseGcFormsStreamConfig(body.config ?? {})
  const answers = typeof body.answers === 'string'
    ? normalizeGcFormsAnswers(body.answers)
    : normalizeGcFormsAnswers(body.answers && typeof body.answers === 'object' ? body.answers as Record<string, unknown> : {})

  return {
    ok: true,
    ...previewGcFormsMapping(answers, config.mappings)
  }
}
