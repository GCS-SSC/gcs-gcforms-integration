import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { authorizeGcFormsStream } from '../runtime.ts'
import { ResolveClaimMaterializationFailureSchema, resolveClaimMaterializationFailure } from '../materialization-failures.ts'

export default defineGcsExtensionRouteHandler(async (context) => {
  const { params, readBody } = context
  const streamId = params.streamId ?? ''
  const submissionId = params.submissionId ?? ''
  await authorizeGcFormsStream(context, streamId, 'update')

  const body = ResolveClaimMaterializationFailureSchema.parse(await readBody())

  return await resolveClaimMaterializationFailure(context, streamId, submissionId, body.agreementId)
})
