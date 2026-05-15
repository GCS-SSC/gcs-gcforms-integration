/* eslint-disable jsdoc/require-jsdoc */
import type { H3Event } from 'h3'
import { asGcFormsIntegrationDb } from '../db'
import { authorizeGcFormsStream, ensureConnection, ensureIntegration, getStreamConfig } from '../runtime'

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

  const db = asGcFormsIntegrationDb(event.context.$db)
  const config = await getStreamConfig(event.context.$db as never, streamId)
  const connection = await ensureConnection(event.context.$db, streamId, config)
  await ensureIntegration(event.context.$db, streamId, String(connection.id), config)

  const items = await db
    .selectFrom('extensions.gcs_gcforms_submissions')
    .selectAll()
    .where('connection_id', '=', String(connection.id))
    .where('_deleted', '=', false)
    .orderBy('created_at', 'desc')
    .execute()

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
}
