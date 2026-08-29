import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import type { GcFormsIntegrationHostDatabase } from '../../server/db.ts'
import { resolveClaimMaterializationFailure } from '../../server/materialization-failures.ts'

const materializeMock = vi.hoisted(() => vi.fn())

vi.mock('../../server/materialize-claims.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/materialize-claims.ts')>(),
  materializeGcFormsClaimSubmission: materializeMock
}))

type TestDb = Kysely<GcFormsIntegrationHostDatabase>

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

const waitForRowLock = async (
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
      throw new Error('Failure resolution completed before waiting for the submission row lock.')
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for the submission row lock.')
}

describe('GC Forms PostgreSQL materialization failure concurrency', () => {
  let holderDb: TestDb
  let waiterDb: TestDb
  let observerDb: TestDb

  beforeAll(async () => {
    holderDb = createPostgresDb()
    waiterDb = createPostgresDb()
    observerDb = createPostgresDb()
    await sql`DROP SCHEMA IF EXISTS extensions CASCADE`.execute(observerDb)
    await sql`CREATE SCHEMA extensions`.execute(observerDb)
    await sql`
      CREATE TABLE extensions.gcs_gcforms_connections (
        id bigserial PRIMARY KEY,
        agency_id bigint NOT NULL,
        stream_id bigint NOT NULL,
        _deleted boolean DEFAULT false NOT NULL
      )
    `.execute(observerDb)
    await sql`
      CREATE TABLE extensions.gcs_gcforms_submissions (
        id bigserial PRIMARY KEY,
        connection_id bigint NOT NULL,
        integration_id bigint,
        form_id varchar(80) NOT NULL,
        submission_name varchar(80) NOT NULL,
        status varchar(40) NOT NULL,
        mapped_values jsonb,
        mapping_issues jsonb,
        diagnostic_code varchar(100),
        diagnostic_params jsonb,
        updated_at timestamptz,
        _deleted boolean DEFAULT false NOT NULL
      )
    `.execute(observerDb)
    await sql`
      CREATE TABLE extensions.gcs_gcforms_materialization_overrides (
        id bigserial PRIMARY KEY,
        submission_id bigint NOT NULL,
        destination_entity varchar(60) NOT NULL,
        destination_path varchar(240) NOT NULL,
        owner_type varchar(80) NOT NULL,
        owner_id bigint NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz,
        _deleted boolean DEFAULT false NOT NULL
      )
    `.execute(observerDb)
    await sql`
      INSERT INTO extensions.gcs_gcforms_connections (id, agency_id, stream_id, _deleted)
      VALUES (801, 20, 30, true)
    `.execute(observerDb)
    await sql`
      INSERT INTO extensions.gcs_gcforms_submissions (
        id,
        connection_id,
        integration_id,
        form_id,
        submission_name,
        status,
        mapped_values,
        mapping_issues
      )
      VALUES (901, 801, 601, 'form-1', 'submission-1', 'materialization_failed', '[]'::jsonb, '[]'::jsonb)
    `.execute(observerDb)
  })

  afterAll(async () => {
    await sql`DROP SCHEMA IF EXISTS extensions CASCADE`.execute(observerDb)
    await Promise.all([holderDb.destroy(), waiterDb.destroy(), observerDb.destroy()])
  })

  it('observes committed status drift after waiting and rejects without side effects', async () => {
    const updateReady = createLatch()
    const releaseUpdate = createLatch()
    const updating = holderDb.transaction().execute(async trx => {
      await trx
        .updateTable('extensions.gcs_gcforms_submissions')
        .set({ status: 'imported' })
        .where('id', '=', '901')
        .execute()
      updateReady.release()
      await releaseUpdate.promise
    })
    await updateReady.promise
    const waiterPid = await sql<{ pid: number }>`SELECT pg_backend_pid()::integer AS pid`
      .execute(waiterDb)
      .then(result => result.rows[0]?.pid)
    if (!waiterPid) {
      throw new Error('Could not resolve failure resolution PostgreSQL pid.')
    }
    const context = {
      db: waiterDb,
      stream: { agencyId: '20' },
      writeAuthorization: {
        lockAuthState: async () => undefined,
        authorizeCurrentScope: async () => undefined,
        authorizeCurrentEntity: async () => undefined,
        lockAndAuthorizeAgreement: async () => true
      }
    } as any
    const resolving = resolveClaimMaterializationFailure(context, '30', '901', '101')
    await waitForRowLock(observerDb, waiterPid, resolving)
    releaseUpdate.release()
    await updating

    await expect(resolving).rejects.toMatchObject({
      statusCode: 409,
      code: 'GCS_GCFORMS_SUBMISSION_NOT_MATERIALIZATION_FAILED'
    })
    expect(materializeMock).not.toHaveBeenCalled()
    await expect(observerDb
      .selectFrom('extensions.gcs_gcforms_materialization_overrides')
      .select(observerDb.fn.countAll().as('count'))
      .executeTakeFirstOrThrow()).resolves.toMatchObject({ count: '0' })
    await expect(observerDb
      .selectFrom('extensions.gcs_gcforms_submissions')
      .select('status')
      .where('id', '=', '901')
      .executeTakeFirstOrThrow()).resolves.toEqual({ status: 'imported' })
  })
})
