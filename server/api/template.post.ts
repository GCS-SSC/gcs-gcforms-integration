/* eslint-disable jsdoc/require-jsdoc */
import type { H3Event } from 'h3'
import { authorizeGcFormsStream, refreshTemplate } from '../runtime'

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

  const result = await refreshTemplate(event.context.$db, streamId)

  return {
    ok: true,
    fieldCatalog: result.fieldCatalog,
    title: {
      en: result.template.titleEn ?? null,
      fr: result.template.titleFr ?? null
    }
  }
}
