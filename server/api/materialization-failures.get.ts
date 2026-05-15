/* eslint-disable jsdoc/require-jsdoc */
import type { H3Event } from 'h3'
import { authorizeGcFormsStream } from '../runtime'
import { listClaimMaterializationFailures } from '../materialization-failures'

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

  return await listClaimMaterializationFailures(event.context.$db, streamId)
}
