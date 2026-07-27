import type { Transaction } from 'kysely'
import {
  createGcsExtensionUserError,
  defineGcsExtensionNitroPlugin,
  lockGcsExtensionLifecycleScope,
  registerGcsExtensionDisableGuard,
  type GcsExtensionDisableGuardContext
} from '@gcs-ssc/extensions/server'
import { GCFORMS_EXTENSION_KEY } from '../../shared/gcforms.ts'
import { asGcFormsIntegrationDb } from '../db.ts'

/** Blocks scope disablement or deletion while GC Forms confirmations remain recoverable. */
export const guardGcFormsLifecycleChange = async (
  context: GcsExtensionDisableGuardContext
): Promise<void> => {
  await lockGcsExtensionLifecycleScope(
    context.db as Transaction<unknown>,
    GCFORMS_EXTENSION_KEY,
    context.agencyId,
    context.scope === 'stream' ? context.streamId : undefined
  )

  const db = asGcFormsIntegrationDb(context.db)
  let query = db
    .selectFrom('extensions.gcs_gcforms_submissions as submission')
    .innerJoin(
      'extensions.gcs_gcforms_connections as connection',
      'connection.id',
      'submission.connection_id'
    )
    .select('submission.id')
    .where('connection.agency_id', '=', context.agencyId)
    .where('submission.status', 'in', ['imported_pending_confirm', 'materialization_failed'])
    .where('submission._deleted', '=', false)

  if (context.scope === 'stream') {
    if (!context.streamId) {
      throw new Error('GC Forms stream lifecycle guards require a stream id.')
    }
    query = query.where('connection.stream_id', '=', context.streamId)
  }

  const recoverableSubmission = await query.executeTakeFirst()
  if (recoverableSubmission) {
    throw createGcsExtensionUserError({
      statusCode: 409,
      code: 'GCS_GCFORMS_SCOPE_RECOVERABLE_SUBMISSIONS',
      message: {
        en: 'GC Forms cannot be disabled or deleted for this scope until all recoverable submissions are resolved.',
        fr: 'GC Forms ne peut pas etre desactive ni supprime pour cette portee tant que toutes les soumissions recuperables ne sont pas reglees.'
      }
    })
  }
}

export default defineGcsExtensionNitroPlugin(nitroApp => {
  registerGcsExtensionDisableGuard(
    GCFORMS_EXTENSION_KEY,
    guardGcFormsLifecycleChange,
    nitroApp
  )
})
