/* eslint-disable jsdoc/require-jsdoc */
import type { H3Event } from 'h3'
import { createGcsExtensionUserError } from '@gcs-ssc/extensions/server'
import { asGcFormsIntegrationDb } from '../db'

type ExtensionEvent = H3Event & {
  context: {
    $db: unknown
    gcsExtension?: {
      entity?: {
        ownerType?: string
        ownerId?: string
      }
    }
  }
}

export default async (event: ExtensionEvent) => {
  const ownerType = event.context.gcsExtension?.entity?.ownerType
  const ownerId = event.context.gcsExtension?.entity?.ownerId
  if (!ownerType || !ownerId) {
    throw createGcsExtensionUserError({
      statusCode: 400,
      code: 'GCS_GCFORMS_ENTITY_CONTEXT_MISSING',
      message: {
        en: 'GC Forms source data could not resolve the current GCS record.',
        fr: 'Les donnees source GC Forms n ont pas pu resoudre l enregistrement GCS courant.'
      }
    })
  }

  const db = asGcFormsIntegrationDb(event.context.$db)

  const items = await db
    .selectFrom('extensions.gcs_gcforms_destination_links')
    .innerJoin(
      'extensions.gcs_gcforms_submissions',
      'extensions.gcs_gcforms_submissions.id',
      'extensions.gcs_gcforms_destination_links.submission_id'
    )
    .select([
      'extensions.gcs_gcforms_submissions.id as id',
      'extensions.gcs_gcforms_submissions.form_id as form_id',
      'extensions.gcs_gcforms_submissions.submission_name as submission_name',
      'extensions.gcs_gcforms_submissions.status as status',
      'extensions.gcs_gcforms_submissions.gcforms_created_at as gcforms_created_at',
      'extensions.gcs_gcforms_submissions.mapped_values as mapped_values',
      'extensions.gcs_gcforms_submissions.mapping_issues as mapping_issues'
    ])
    .where('extensions.gcs_gcforms_destination_links.owner_type', '=', ownerType)
    .where('extensions.gcs_gcforms_destination_links.owner_id', '=', ownerId)
    .where('extensions.gcs_gcforms_destination_links._deleted', '=', false)
    .where('extensions.gcs_gcforms_submissions._deleted', '=', false)
    .orderBy('extensions.gcs_gcforms_submissions.gcforms_created_at', 'desc')
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
