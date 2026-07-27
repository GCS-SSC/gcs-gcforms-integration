import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { asGcFormsIntegrationDb } from '../db.ts'
import { authorizeGcFormsStream, findCurrentGcFormsConnection, getStreamConfig } from '../runtime.ts'

export default defineGcsExtensionRouteHandler(async (context) => {
  const { params, db: rawDb } = context
  const streamId = params.streamId ?? ''
  await authorizeGcFormsStream(context, streamId, 'read')

  const db = asGcFormsIntegrationDb(rawDb)
  const config = await getStreamConfig(db, streamId)
  const connection = await findCurrentGcFormsConnection(db, streamId, config)
  const items = connection
    ? await db
        .selectFrom('extensions.gcs_gcforms_submissions')
        .selectAll()
        .where('connection_id', '=', String(connection.id))
        .where('_deleted', '=', false)
        .orderBy('created_at', 'desc')
        .execute()
    : []

  return {
    items,
    total: items.length,
    stats: {
      total: items.length,
      active: items.filter(item => item.status !== 'confirmed').length
    },
    page: 1,
    limit: items.length || 10
  }
})
