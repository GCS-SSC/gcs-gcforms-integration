import { createGcsExtensionUserError, defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import { asGcFormsIntegrationDb } from '../db.ts'
import { getGcFormsDiagnosticLocale, renderStoredGcFormsMappingIssues } from '../diagnostics.ts'

export default defineGcsExtensionRouteHandler(async (context) => {
  const { entity, db: rawDb } = context
  const ownerType = entity?.ownerType
  const ownerId = entity?.ownerId
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

  const db = asGcFormsIntegrationDb(rawDb)

  const rows = await db
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
    .where('extensions.gcs_gcforms_destination_links.owner_type', '=', String(ownerType))
    .where('extensions.gcs_gcforms_destination_links.owner_id', '=', String(ownerId))
    .where('extensions.gcs_gcforms_destination_links._deleted', '=', false)
    .where('extensions.gcs_gcforms_submissions._deleted', '=', false)
    .orderBy('extensions.gcs_gcforms_submissions.gcforms_created_at', 'desc')
    .execute()
  const locale = getGcFormsDiagnosticLocale(context)
  const items = rows.map(row => ({
    ...row,
    mapping_issues: renderStoredGcFormsMappingIssues(row.mapping_issues, locale)
  }))

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
