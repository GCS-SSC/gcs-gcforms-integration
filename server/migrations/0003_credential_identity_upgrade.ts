import { sql } from 'kysely'
import { defineGcsExtensionMigration } from '@gcs-ssc/extensions/server'

/** Upgrades installations that applied the original migration before credential identity versioning was added. */
export default defineGcsExtensionMigration({
  up: async db => {
    await sql`
      ALTER TABLE extensions.gcs_gcforms_credentials
      ADD COLUMN IF NOT EXISTS revision integer DEFAULT 1 NOT NULL
    `.execute(db)

    await sql`
      ALTER TABLE extensions.gcs_gcforms_connections
      ADD COLUMN IF NOT EXISTS credential_revision integer,
      ADD COLUMN IF NOT EXISTS secret_entry_id bigint REFERENCES extensions.secret_entry(id) ON DELETE RESTRICT,
      ADD COLUMN IF NOT EXISTS secret_updated_at timestamptz
    `.execute(db)

    await sql`
      UPDATE extensions.gcs_gcforms_connections connection
      SET credential_revision = credential.revision,
          secret_entry_id = (
            SELECT secret.id
            FROM extensions.secret_entry secret
            WHERE secret.extension_key = 'gcs-gcforms-integration'
              AND secret.owner_type = 'agency'
              AND secret.owner_id = credential.agency_id::text
              AND secret.secret_key = credential.id::text
            ORDER BY secret._deleted ASC, COALESCE(secret.updated_at, secret.created_at) DESC, secret.id DESC
            LIMIT 1
          ),
          secret_updated_at = (
            SELECT COALESCE(secret.updated_at, secret.created_at)
            FROM extensions.secret_entry secret
            WHERE secret.extension_key = 'gcs-gcforms-integration'
              AND secret.owner_type = 'agency'
              AND secret.owner_id = credential.agency_id::text
              AND secret.secret_key = credential.id::text
            ORDER BY secret._deleted ASC, COALESCE(secret.updated_at, secret.created_at) DESC, secret.id DESC
            LIMIT 1
          )
      FROM extensions.gcs_gcforms_credentials credential
      WHERE connection.credential_id = credential.id::text
        AND connection.agency_id = credential.agency_id
        AND (connection.credential_revision IS NULL
          OR connection.secret_entry_id IS NULL
          OR connection.secret_updated_at IS NULL)
    `.execute(db)

    await sql`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM extensions.gcs_gcforms_connections
          WHERE credential_revision IS NULL OR secret_entry_id IS NULL OR secret_updated_at IS NULL
        ) THEN
          RAISE EXCEPTION 'GC Forms connection credential identity could not be backfilled';
        END IF;
      END $$
    `.execute(db)

    await sql`
      ALTER TABLE extensions.gcs_gcforms_connections
      ALTER COLUMN credential_revision SET NOT NULL,
      ALTER COLUMN secret_entry_id SET NOT NULL,
      ALTER COLUMN secret_updated_at SET NOT NULL
    `.execute(db)

    await sql`DROP INDEX IF EXISTS extensions.gcs_gcforms_connection_stream_credential`.execute(db)
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS gcs_gcforms_connection_remote_identity
      ON extensions.gcs_gcforms_connections (
        stream_id, credential_id, credential_revision, secret_entry_id, secret_updated_at,
        form_id, api_url, identity_provider_url, project_identifier
      )
      WHERE _deleted = false
    `.execute(db)

    await sql`
      ALTER TABLE extensions.gcs_gcforms_integrations
      ADD COLUMN IF NOT EXISTS config_fingerprint varchar(64)
    `.execute(db)
    await sql`
      UPDATE extensions.gcs_gcforms_integrations
      SET config_fingerprint = 'legacy-' || md5(config::text)
      WHERE config_fingerprint IS NULL
    `.execute(db)
    await sql`
      ALTER TABLE extensions.gcs_gcforms_integrations
      ALTER COLUMN config_fingerprint SET NOT NULL
    `.execute(db)
    await sql`DROP INDEX IF EXISTS extensions.gcs_gcforms_integration_connection`.execute(db)
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS gcs_gcforms_integration_identity
      ON extensions.gcs_gcforms_integrations (connection_id, config_fingerprint)
      WHERE _deleted = false
    `.execute(db)
  }
})
