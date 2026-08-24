import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import migration from '../../server/migrations/0003_credential_identity_upgrade'

let db: Kysely<unknown>

describe('GC Forms deployed credential identity upgrade', () => {
  beforeEach(async () => {
    const pglite = await KyselyPGlite.create(`memory://gcforms-identity-upgrade-${Date.now()}`)
    db = new Kysely({ dialect: pglite.dialect })
    await sql`CREATE SCHEMA extensions`.execute(db)
    await sql`
      CREATE TABLE extensions.secret_entry (
        id bigserial PRIMARY KEY, extension_key text NOT NULL, owner_type text NOT NULL,
        owner_id text NOT NULL, secret_key text NOT NULL, created_at timestamptz NOT NULL,
        updated_at timestamptz, _deleted boolean NOT NULL
      )
    `.execute(db)
    await sql`
      CREATE TABLE extensions.gcs_gcforms_credentials (
        id bigserial PRIMARY KEY, agency_id bigint NOT NULL
      )
    `.execute(db)
    await sql`
      CREATE TABLE extensions.gcs_gcforms_connections (
        id bigserial PRIMARY KEY, agency_id bigint NOT NULL, stream_id bigint NOT NULL,
        credential_id text NOT NULL, form_id text NOT NULL, api_url text NOT NULL,
        identity_provider_url text NOT NULL, project_identifier text NOT NULL,
        _deleted boolean NOT NULL
      )
    `.execute(db)
    await sql`
      CREATE UNIQUE INDEX gcs_gcforms_connection_stream_credential
      ON extensions.gcs_gcforms_connections (stream_id, credential_id) WHERE _deleted = false
    `.execute(db)
    await sql`
      CREATE TABLE extensions.gcs_gcforms_integrations (
        id bigserial PRIMARY KEY, connection_id bigint NOT NULL, config jsonb NOT NULL,
        _deleted boolean NOT NULL
      )
    `.execute(db)
    await sql`
      CREATE UNIQUE INDEX gcs_gcforms_integration_connection
      ON extensions.gcs_gcforms_integrations (connection_id) WHERE _deleted = false
    `.execute(db)
  })

  afterEach(async () => await db.destroy())

  it('backfills a deleted connection from its deleted historical secret', async () => {
    await sql`INSERT INTO extensions.gcs_gcforms_credentials (id, agency_id) VALUES (7, 20)`.execute(db)
    await sql`
      INSERT INTO extensions.secret_entry
        (id, extension_key, owner_type, owner_id, secret_key, created_at, updated_at, _deleted)
      VALUES (9, 'gcs-gcforms-integration', 'agency', '20', '7', now(), NULL, true)
    `.execute(db)
    await sql`
      INSERT INTO extensions.gcs_gcforms_connections
        (id, agency_id, stream_id, credential_id, form_id, api_url, identity_provider_url, project_identifier, _deleted)
      VALUES (11, 20, 30, '7', 'form-1', 'https://api.example/v1', 'https://id.example', 'forms-form1', true)
    `.execute(db)
    await sql`
      INSERT INTO extensions.gcs_gcforms_integrations (connection_id, config, _deleted)
      VALUES (11, '{}'::jsonb, true)
    `.execute(db)

    await migration.up(db as never)

    await expect(sql<{ credential_revision: number, secret_entry_id: number }>`
      SELECT credential_revision, secret_entry_id
      FROM extensions.gcs_gcforms_connections WHERE id = 11
    `.execute(db).then(result => result.rows[0])).resolves.toMatchObject({
      credential_revision: 1,
      secret_entry_id: 9
    })
  })
})
