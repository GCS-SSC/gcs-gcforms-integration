/* eslint-disable jsdoc/require-jsdoc */
import { readBody } from 'h3'
import type { H3Event } from 'h3'
import { authorizeGcFormsStream } from '../runtime'
import { ResolveClaimMaterializationFailureSchema, resolveClaimMaterializationFailure } from '../materialization-failures'

type ExtensionEvent = H3Event & {
  context: {
    $authContext?: unknown
    $db: unknown
    params?: Record<string, string | undefined>
  }
}

export default async (event: ExtensionEvent) => {
  const streamId = event.context.params?.streamId ?? ''
  const submissionId = event.context.params?.submissionId ?? ''
  await authorizeGcFormsStream(event as never, streamId, 'update')

  const body = ResolveClaimMaterializationFailureSchema.parse(await readBody(event))

  return await resolveClaimMaterializationFailure(event.context.$db, streamId, submissionId, body.agreementId)
}
