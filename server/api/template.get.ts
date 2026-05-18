/* eslint-disable jsdoc/require-jsdoc */
import type { H3Event } from 'h3'
import { authorizeGcFormsStream, getStoredTemplate } from '../runtime'

type ExtensionEvent = H3Event & {
  context: {
    $authContext?: unknown
    $db: unknown
    params?: Record<string, string | undefined>
  }
}

export default async (event: ExtensionEvent) => {
  const streamId = event.context.params?.streamId ?? ''
  await authorizeGcFormsStream(event as never, streamId, 'read')

  return await getStoredTemplate(event.context.$db, streamId)
}
