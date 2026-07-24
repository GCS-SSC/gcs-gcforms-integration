import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { authorizeGcFormsStream, refreshTemplate } from '../runtime'

export default defineGcsExtensionRouteHandler(async (context) => {
  const { params, db } = context
  const streamId = params.streamId ?? ''
  await authorizeGcFormsStream(context, streamId, 'update')

  const result = await refreshTemplate(db, streamId)

  return {
    ok: true,
    fieldCatalog: result.fieldCatalog,
    title: {
      en: result.template.titleEn ?? null,
      fr: result.template.titleFr ?? null
    }
  }
})
