import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { authorizeGcFormsStream, refreshTemplate, runAuthorizedGcFormsWrite } from '../runtime.ts'

export default defineGcsExtensionRouteHandler(async (context) => {
  const { params } = context
  const streamId = params.streamId ?? ''
  await authorizeGcFormsStream(context, streamId, 'update')

  const result = await runAuthorizedGcFormsWrite(
    context,
    async trx => await refreshTemplate(trx, streamId),
    streamId
  )

  return {
    ok: true,
    fieldCatalog: result.fieldCatalog,
    title: {
      en: result.template.titleEn ?? null,
      fr: result.template.titleFr ?? null
    }
  }
})
