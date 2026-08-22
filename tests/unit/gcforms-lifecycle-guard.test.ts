import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import type {
  GcsExtensionConfigurationGuardHookPayload,
  GcsExtensionDisableGuardHookPayload,
  GcsExtensionStatusReferenceGuardHookPayload
} from '@gcs-ssc/extensions/server'
import type { GcFormsIntegrationHostDatabase } from '../../server/db.ts'
import lifecyclePlugin from '../../server/plugins/lifecycle-guards.ts'
import { GCFORMS_EXTENSION_KEY } from '../../shared/gcforms.ts'

type TestDb = Kysely<GcFormsIntegrationHostDatabase>
type DisableHook = (payload: GcsExtensionDisableGuardHookPayload) => Promise<void> | void
type ConfigurationHook = (payload: GcsExtensionConfigurationGuardHookPayload) => Promise<void> | void
type StatusReferenceHook = (payload: GcsExtensionStatusReferenceGuardHookPayload) => Promise<void> | void

let db: TestDb
let disableHook: DisableHook
let configurationHook: ConfigurationHook
let statusReferenceHook: StatusReferenceHook

const invokeGuard = async (
  scope: 'agency' | 'stream',
  agencyId: string,
  streamId?: string
) => await db.transaction().execute(async trx => await disableHook({
  extensionKey: GCFORMS_EXTENSION_KEY,
  scope,
  event: {},
  db: trx as unknown as GcsExtensionDisableGuardHookPayload['db'],
  agencyId,
  ...(streamId ? { streamId } : {})
}))

const invokeConfigurationGuard = async (
  agencyId: string,
  submissionStatusId?: string
) => await db.transaction().execute(async trx => await configurationHook({
  targetExtensionKey: GCFORMS_EXTENSION_KEY,
  scope: 'agency',
  event: {},
  db: trx as unknown as GcsExtensionConfigurationGuardHookPayload['db'],
  agencyId,
  enabled: true,
  config: submissionStatusId ? { submissionStatusId } : {}
}))

const invokeStatusReferenceGuard = async (
  agencyId: string,
  statusId: string
) => await db.transaction().execute(async trx => await statusReferenceHook({
  event: {},
  db: trx as unknown as GcsExtensionStatusReferenceGuardHookPayload['db'],
  agencyId,
  statusId
}))

beforeEach(async () => {
  const pglite = await KyselyPGlite.create(`memory://gcforms-lifecycle-${Date.now()}`)
  db = new Kysely<GcFormsIntegrationHostDatabase>({ dialect: pglite.dialect })
  await sql`CREATE SCHEMA extensions`.execute(db)
  await sql`
    CREATE TABLE "Common_Status" (
      id bigserial PRIMARY KEY,
      egcs_cn_agency bigint NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE extensions.agency_enablement (
      id bigserial PRIMARY KEY,
      extension_key varchar(120) NOT NULL,
      agency_id bigint NOT NULL,
      enabled boolean DEFAULT false NOT NULL,
      config jsonb DEFAULT '{}'::jsonb NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE extensions.gcs_gcforms_connections (
      id bigserial PRIMARY KEY,
      agency_id bigint NOT NULL,
      stream_id bigint NOT NULL,
      credential_id varchar(120) NOT NULL,
      credential_revision integer NOT NULL,
      secret_entry_id bigint NOT NULL,
      secret_updated_at timestamptz NOT NULL,
      form_id varchar(80) NOT NULL,
      api_url text NOT NULL,
      identity_provider_url text NOT NULL,
      project_identifier varchar(80) NOT NULL,
      contact_email varchar(320),
      preferred_language varchar(2) DEFAULT 'en' NOT NULL,
      status varchar(30) DEFAULT 'active' NOT NULL,
      last_template_refresh_at timestamptz,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE extensions.gcs_gcforms_submissions (
      id bigserial PRIMARY KEY,
      connection_id bigint NOT NULL,
      integration_id bigint,
      form_id varchar(80) NOT NULL,
      submission_name varchar(80) NOT NULL,
      status varchar(40) NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)

  const hooks: DisableHook[] = []
  const configurationHooks: ConfigurationHook[] = []
  const statusReferenceHooks: StatusReferenceHook[] = []
  lifecyclePlugin({
    hooks: {
      hook: (name, handler) => {
        if (name === 'gcs:extension:disable-guard') {
          hooks.push(handler as DisableHook)
        } else if (name === 'gcs:extension:configuration-guard') {
          configurationHooks.push(handler as ConfigurationHook)
        } else if (name === 'gcs:extension:status-reference-guard') {
          statusReferenceHooks.push(handler as StatusReferenceHook)
        }
      }
    }
  })
  const registeredHook = hooks[0]
  if (!registeredHook) {
    throw new Error('GC Forms lifecycle guard was not registered.')
  }
  disableHook = registeredHook
  const registeredConfigurationHook = configurationHooks[0]
  const registeredStatusReferenceHook = statusReferenceHooks[0]
  if (!registeredConfigurationHook || !registeredStatusReferenceHook) {
    throw new Error('GC Forms status guards were not registered.')
  }
  configurationHook = registeredConfigurationHook
  statusReferenceHook = registeredStatusReferenceHook
})

afterEach(async () => {
  await db.destroy()
})

describe('GC Forms registered lifecycle guard', () => {
  it.each(['imported_pending_confirm', 'materialization_failed'])(
    'rejects stream disable or deletion for recoverable %s rows on historical connections',
    async status => {
    const connection = await db
      .insertInto('extensions.gcs_gcforms_connections')
      .values({
        agency_id: '20',
        stream_id: '30',
        credential_id: '1',
        credential_revision: 1,
        secret_entry_id: '1',
        secret_updated_at: new Date(0),
        form_id: 'form-1',
        api_url: 'https://api.example.test',
        identity_provider_url: 'https://idp.example.test',
        project_identifier: 'project-1',
        contact_email: null,
        preferred_language: 'en',
        status: 'active',
        _deleted: true
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    await db
      .insertInto('extensions.gcs_gcforms_submissions')
      .values({
        connection_id: String(connection.id),
        integration_id: null,
        form_id: 'form-1',
        submission_name: 'pending-1',
        status
      })
      .execute()

    await expect(invokeGuard('stream', '20', '30')).rejects.toMatchObject({
      statusCode: 409,
      code: 'GCS_GCFORMS_SCOPE_RECOVERABLE_SUBMISSIONS',
      localizedMessage: {
        en: expect.stringContaining('cannot be disabled or deleted'),
        fr: expect.stringContaining('ne peut pas etre desactive ni supprime')
      }
    })
      await expect(invokeGuard('stream', '20', '31')).resolves.toBeUndefined()
    }
  )

  it('rejects agency disable or deletion when any agency stream has a pending confirmation', async () => {
    const connection = await db
      .insertInto('extensions.gcs_gcforms_connections')
      .values({
        agency_id: '20',
        stream_id: '31',
        credential_id: '1',
        credential_revision: 1,
        secret_entry_id: '1',
        secret_updated_at: new Date(0),
        form_id: 'form-1',
        api_url: 'https://api.example.test',
        identity_provider_url: 'https://idp.example.test',
        project_identifier: 'project-1',
        contact_email: null,
        preferred_language: 'en',
        status: 'active'
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    await db
      .insertInto('extensions.gcs_gcforms_submissions')
      .values({
        connection_id: String(connection.id),
        integration_id: null,
        form_id: 'form-1',
        submission_name: 'pending-2',
        status: 'imported_pending_confirm'
      })
      .execute()

    await expect(invokeGuard('agency', '20')).rejects.toMatchObject({
      code: 'GCS_GCFORMS_SCOPE_RECOVERABLE_SUBMISSIONS'
    })
    await expect(invokeGuard('agency', '21')).resolves.toBeUndefined()
  })

  it('requires and Agency-scopes the configured imported claim status', async () => {
    await db
      .insertInto('Common_Status')
      .values([
        { id: '91', egcs_cn_agency: '20' },
        { id: '92', egcs_cn_agency: '21' },
        { id: '93', egcs_cn_agency: '20', _deleted: true }
      ])
      .execute()

    await expect(invokeConfigurationGuard('20')).rejects.toMatchObject({
      code: 'GCS_GCFORMS_SUBMISSION_STATUS_REQUIRED'
    })
    await expect(invokeConfigurationGuard('20', '92')).rejects.toMatchObject({
      code: 'GCS_GCFORMS_SUBMISSION_STATUS_UNAVAILABLE'
    })
    await expect(invokeConfigurationGuard('20', '93')).rejects.toMatchObject({
      code: 'GCS_GCFORMS_SUBMISSION_STATUS_UNAVAILABLE'
    })
    await expect(invokeConfigurationGuard('20', '91')).resolves.toBeUndefined()
  })

  it('blocks deletion only for the exact live GC Forms Agency status reference', async () => {
    await db
      .insertInto('extensions.agency_enablement')
      .values({
        extension_key: GCFORMS_EXTENSION_KEY,
        agency_id: '20',
        enabled: true,
        config: { submissionStatusId: '91' }
      })
      .execute()

    await expect(invokeStatusReferenceGuard('20', '91')).rejects.toMatchObject({
      code: 'GCS_GCFORMS_SUBMISSION_STATUS_REFERENCED'
    })
    await expect(invokeStatusReferenceGuard('20', '92')).resolves.toBeUndefined()
    await expect(invokeStatusReferenceGuard('21', '91')).resolves.toBeUndefined()
  })
})
