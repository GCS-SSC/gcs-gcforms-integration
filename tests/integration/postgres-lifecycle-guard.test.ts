import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import {
  lockGcsExtensionLifecycleScope,
  type GcsExtensionConfigurationGuardHookPayload,
  type GcsExtensionDisableGuardHookPayload
} from '@gcs-ssc/extensions/server'
import type { GcFormsIntegrationHostDatabase } from '../../server/db.ts'
import lifecyclePlugin from '../../server/plugins/lifecycle-guards.ts'
import { ensureIntegration } from '../../server/runtime.ts'
import { GCFORMS_EXTENSION_KEY } from '../../shared/gcforms.ts'

type TestDb = Kysely<GcFormsIntegrationHostDatabase>
type DisableHook = (payload: GcsExtensionDisableGuardHookPayload) => Promise<void> | void
type ConfigurationHook = (payload: GcsExtensionConfigurationGuardHookPayload) => Promise<void> | void

const postgresTestUrl = process.env.GCFORMS_POSTGRES_TEST_URL
  ?? process.env.AGREEMENT_CONCURRENCY_POSTGRES_TEST_URL

const requireDisposablePostgresUrl = (): string => {
  if (!postgresTestUrl) {
    throw new Error(
      'GCFORMS_POSTGRES_TEST_URL or AGREEMENT_CONCURRENCY_POSTGRES_TEST_URL is required for the opt-in PostgreSQL suite.'
    )
  }
  const databaseName = new URL(postgresTestUrl).pathname.slice(1)
  if (!databaseName.endsWith('_test')) {
    throw new Error('The GC Forms PostgreSQL suite requires a disposable database ending in _test.')
  }
  return postgresTestUrl
}

const disposablePostgresUrl = requireDisposablePostgresUrl()
const createPostgresDb = (): TestDb => new Kysely<GcFormsIntegrationHostDatabase>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: disposablePostgresUrl, max: 1 })
  })
})

const createLatch = () => {
  let release = () => {}
  const promise = new Promise<void>(resolve => {
    release = resolve
  })
  return { promise, release }
}

const waitForAdvisoryLock = async (
  observerDb: TestDb,
  waiterPid: number,
  operation: Promise<unknown>
): Promise<void> => {
  let completed = false
  operation.finally(() => {
    completed = true
  }).catch(() => undefined)

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const activity = await sql<{ wait_event_type: string | null }>`
      SELECT wait_event_type
      FROM pg_stat_activity
      WHERE pid = ${waiterPid}
    `.execute(observerDb)
    if (activity.rows[0]?.wait_event_type === 'Lock') {
      return
    }
    if (completed) {
      throw new Error('Lifecycle guard completed before waiting for the advisory lock.')
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for the lifecycle guard advisory lock.')
}

const loadDisableGuard = (): DisableHook => {
  const hooks: DisableHook[] = []
  lifecyclePlugin({
    hooks: {
      hook: (name, handler) => {
        if (name === 'gcs:extension:disable-guard') {
          hooks.push(handler as DisableHook)
        }
      }
    }
  })
  const guard = hooks[0]
  if (!guard) {
    throw new Error('GC Forms lifecycle guard was not registered.')
  }
  return guard
}

const loadConfigurationGuard = (): ConfigurationHook => {
  const hooks: ConfigurationHook[] = []
  lifecyclePlugin({
    hooks: {
      hook: (name, handler) => {
        if (name === 'gcs:extension:configuration-guard') {
          hooks.push(handler as ConfigurationHook)
        }
      }
    }
  })
  const guard = hooks[0]
  if (!guard) throw new Error('GC Forms configuration guard was not registered.')
  return guard
}

describe('GC Forms PostgreSQL lifecycle guard concurrency', () => {
  let holderDb: TestDb
  let waiterDb: TestDb
  let observerDb: TestDb
  let guard: DisableHook

  beforeAll(async () => {
    holderDb = createPostgresDb()
    waiterDb = createPostgresDb()
    observerDb = createPostgresDb()
    guard = loadDisableGuard()
    await sql`DROP SCHEMA IF EXISTS extensions CASCADE`.execute(observerDb)
    await sql`CREATE SCHEMA extensions`.execute(observerDb)
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
        preferred_language varchar(2) NOT NULL DEFAULT 'en',
        status varchar(30) NOT NULL DEFAULT 'active',
        last_template_refresh_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz,
        _deleted boolean NOT NULL DEFAULT false
      )
    `.execute(observerDb)
    await sql`
      CREATE UNIQUE INDEX gcs_gcforms_connection_remote_identity
      ON extensions.gcs_gcforms_connections (
        stream_id,
        credential_id,
        credential_revision,
        secret_entry_id,
        secret_updated_at,
        form_id,
        api_url,
        identity_provider_url,
        project_identifier
      )
      WHERE _deleted = false
    `.execute(observerDb)
    await sql`
      CREATE TABLE extensions.gcs_gcforms_submissions (
        id bigserial PRIMARY KEY,
        connection_id bigint NOT NULL,
        integration_id bigint,
        form_id varchar(80) NOT NULL,
        submission_name varchar(80) NOT NULL,
        status varchar(40) NOT NULL,
        _deleted boolean NOT NULL DEFAULT false
      )
    `.execute(observerDb)
    await sql`
      CREATE TABLE extensions.gcs_gcforms_integrations (
        id bigserial PRIMARY KEY,
        connection_id bigint NOT NULL,
        stream_id bigint NOT NULL,
        name_en varchar(200) NOT NULL,
        name_fr varchar(200) NOT NULL,
        enabled boolean DEFAULT true NOT NULL,
        config_fingerprint varchar(64) NOT NULL,
        config jsonb NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz,
        _deleted boolean DEFAULT false NOT NULL
      )
    `.execute(observerDb)
    await sql`
      CREATE UNIQUE INDEX gcs_gcforms_integration_identity
      ON extensions.gcs_gcforms_integrations (connection_id, config_fingerprint)
      WHERE _deleted = false
    `.execute(observerDb)
    await sql`
      CREATE TABLE extensions.gcs_gcforms_field_mappings (
        id bigserial PRIMARY KEY,
        integration_id bigint NOT NULL,
        mapping_key varchar(120) NOT NULL,
        source_question_id varchar(200) NOT NULL,
        destination_entity varchar(60) NOT NULL,
        destination_path varchar(240) NOT NULL,
        transform varchar(40) NOT NULL,
        required boolean DEFAULT false NOT NULL,
        default_value jsonb,
        on_missing varchar(20) DEFAULT 'block' NOT NULL,
        on_invalid varchar(20) DEFAULT 'block' NOT NULL,
        _deleted boolean DEFAULT false NOT NULL
      )
    `.execute(observerDb)
  })

  beforeEach(async () => {
    await sql`
      TRUNCATE TABLE
        extensions.gcs_gcforms_field_mappings,
        extensions.gcs_gcforms_integrations,
        extensions.gcs_gcforms_submissions,
        extensions.gcs_gcforms_connections
      RESTART IDENTITY CASCADE
    `.execute(observerDb)
  })

  afterAll(async () => {
    await sql`DROP SCHEMA IF EXISTS extensions CASCADE`.execute(observerDb)
    await Promise.all([holderDb.destroy(), waiterDb.destroy(), observerDb.destroy()])
  })

  it('makes stream deletion or disable wait for recovery failure commit, then rejects the durable recoverable row', async () => {
    const importReady = createLatch()
    const releaseImport = createLatch()
    const importing = holderDb.transaction().execute(async trx => {
      await lockGcsExtensionLifecycleScope(
        trx as unknown as GcsExtensionDisableGuardHookPayload['db'],
        GCFORMS_EXTENSION_KEY,
        '20',
        '30'
      )
      const connection = await trx
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
          status: 'active'
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      await trx
        .insertInto('extensions.gcs_gcforms_submissions')
        .values({
          connection_id: String(connection.id),
          integration_id: null,
          form_id: 'form-1',
          submission_name: 'failed-import',
          status: 'materialization_failed'
        })
        .execute()
      importReady.release()
      await releaseImport.promise
    })
    await importReady.promise
    const waiterPid = await sql<{ pid: number }>`SELECT pg_backend_pid()::integer AS pid`
      .execute(waiterDb)
      .then(result => result.rows[0]?.pid)
    if (!waiterPid) {
      throw new Error('Could not resolve lifecycle guard PostgreSQL pid.')
    }
    const deleting = waiterDb.transaction().execute(async trx => await guard({
      extensionKey: GCFORMS_EXTENSION_KEY,
      scope: 'stream',
      event: {},
      db: trx as unknown as GcsExtensionDisableGuardHookPayload['db'],
      agencyId: '20',
      streamId: '30'
    }))
    await waitForAdvisoryLock(observerDb, waiterPid, deleting)
    releaseImport.release()
    await importing
    await expect(deleting).rejects.toMatchObject({
      code: 'GCS_GCFORMS_SCOPE_RECOVERABLE_SUBMISSIONS'
    })
  })

  it('makes agency deletion or disable wait for reconciliation, then permits the resolved scope', async () => {
    const connection = await observerDb
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
        status: 'active'
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    await observerDb
      .insertInto('extensions.gcs_gcforms_submissions')
      .values({
        connection_id: String(connection.id),
        integration_id: null,
        form_id: 'form-1',
        submission_name: 'pending-reconcile',
        status: 'imported_pending_confirm'
      })
      .execute()

    const reconciliationReady = createLatch()
    const releaseReconciliation = createLatch()
    const reconciling = holderDb.transaction().execute(async trx => {
      await lockGcsExtensionLifecycleScope(
        trx as unknown as GcsExtensionDisableGuardHookPayload['db'],
        GCFORMS_EXTENSION_KEY,
        '20',
        '30'
      )
      await trx
        .updateTable('extensions.gcs_gcforms_submissions')
        .set({ status: 'imported' })
        .where('submission_name', '=', 'pending-reconcile')
        .execute()
      reconciliationReady.release()
      await releaseReconciliation.promise
    })
    await reconciliationReady.promise
    const waiterPid = await sql<{ pid: number }>`SELECT pg_backend_pid()::integer AS pid`
      .execute(waiterDb)
      .then(result => result.rows[0]?.pid)
    if (!waiterPid) {
      throw new Error('Could not resolve lifecycle guard PostgreSQL pid.')
    }
    const disabling = waiterDb.transaction().execute(async trx => await guard({
      extensionKey: GCFORMS_EXTENSION_KEY,
      scope: 'agency',
      event: {},
      db: trx as unknown as GcsExtensionDisableGuardHookPayload['db'],
      agencyId: '20'
    }))
    await waitForAdvisoryLock(observerDb, waiterPid, disabling)
    releaseReconciliation.release()
    await reconciling
    await expect(disabling).resolves.toBeUndefined()
  })

  it('idempotently resolves concurrent inserts of the same complete remote identity', async () => {
    const values = {
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
      preferred_language: 'en' as const,
      status: 'active'
    }
    const insert = async (database: TestDb) => await database
      .insertInto('extensions.gcs_gcforms_connections')
      .values(values)
      .onConflict(conflict => conflict.doNothing())
      .returning('id')
      .executeTakeFirst()

    const results = await Promise.all([insert(holderDb), insert(waiterDb)])
    expect(results.filter(Boolean)).toHaveLength(1)
    await expect(observerDb
      .selectFrom('extensions.gcs_gcforms_connections')
      .select(observerDb.fn.countAll().as('count'))
      .where('_deleted', '=', false)
      .executeTakeFirstOrThrow()).resolves.toMatchObject({ count: '1' })
  })

  it('accepts only the locked live Agency Draft status during configuration', async () => {
    await sql`DROP TABLE IF EXISTS pg_temp."Common_Status"`.execute(waiterDb)
    await sql`
      CREATE TEMP TABLE "Common_Status" (
        id bigint PRIMARY KEY,
        egcs_cn_agency bigint NOT NULL,
        egcs_cn_isdraft boolean NOT NULL,
        _deleted boolean NOT NULL DEFAULT false
      ) ON COMMIT PRESERVE ROWS
    `.execute(waiterDb)
    await sql`
      INSERT INTO "Common_Status" (id, egcs_cn_agency, egcs_cn_isdraft)
      VALUES (910091, 20, true), (910092, 20, false), (910093, 21, true)
    `.execute(waiterDb)
    const configurationGuard = loadConfigurationGuard()
    const invoke = async (statusId: string) => await waiterDb.transaction().execute(async trx =>
      await configurationGuard({
        extensionKey: GCFORMS_EXTENSION_KEY,
        targetExtensionKey: GCFORMS_EXTENSION_KEY,
        scope: 'agency',
        event: {},
        db: trx as unknown as GcsExtensionConfigurationGuardHookPayload['db'],
        agencyId: '20',
        enabled: true,
        config: { submissionStatusId: statusId }
      }))

    await expect(invoke('910091')).resolves.toBeUndefined()
    await expect(invoke('910092')).rejects.toMatchObject({
      code: 'GCS_GCFORMS_SUBMISSION_STATUS_NOT_DRAFT'
    })
    await expect(invoke('910093')).rejects.toMatchObject({
      code: 'GCS_GCFORMS_SUBMISSION_STATUS_UNAVAILABLE'
    })
  })

  it('atomically resolves concurrent creation of the same integration and mapping identity', async () => {
    const connection = await observerDb
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
        status: 'active'
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    const config = {
      credentialId: '1',
      mappings: [{
        id: 'agreement-number',
        sourceQuestionId: 'agreement_number',
        destinationEntity: 'claim' as const,
        destinationPath: 'egcs_fc_fundingagreement',
        transform: 'string' as const,
        required: true,
        onMissing: 'block' as const,
        onInvalid: 'block' as const
      }]
    }

    const integrations = await Promise.all([
      ensureIntegration(holderDb, '30', String(connection.id), config),
      ensureIntegration(waiterDb, '30', String(connection.id), config)
    ])
    expect(String(integrations[0]?.id)).toBe(String(integrations[1]?.id))
    await expect(observerDb
      .selectFrom('extensions.gcs_gcforms_integrations')
      .select(observerDb.fn.countAll().as('count'))
      .where('_deleted', '=', false)
      .executeTakeFirstOrThrow()).resolves.toMatchObject({ count: '1' })
    await expect(observerDb
      .selectFrom('extensions.gcs_gcforms_field_mappings')
      .select(observerDb.fn.countAll().as('count'))
      .where('_deleted', '=', false)
      .executeTakeFirstOrThrow()).resolves.toMatchObject({ count: '1' })
  })
})
