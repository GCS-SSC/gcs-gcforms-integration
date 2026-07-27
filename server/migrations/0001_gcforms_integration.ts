import { sql } from 'kysely'
import { defineGcsExtensionMigration } from '@gcs-ssc/extensions/server'

export default defineGcsExtensionMigration({
  up: async db => {
    await db.schema
      .createTable('extensions.gcs_gcforms_credentials')
      .ifNotExists()
      .addColumn('id', 'bigserial', col => col.primaryKey())
      .addColumn('agency_id', 'bigint', col => col.notNull().references('Agency_Profile.id').onDelete('restrict'))
      .addColumn('name_en', 'varchar(200)', col => col.notNull())
      .addColumn('name_fr', 'varchar(200)', col => col.notNull())
      .addColumn('key_id', 'varchar(200)', col => col.notNull())
      .addColumn('user_id', 'varchar(200)', col => col.notNull())
      .addColumn('form_id', 'varchar(80)', col => col.notNull())
      .addColumn('revision', 'integer', col => col.defaultTo(1).notNull())
      .addColumn('created_at', 'timestamptz', col => col.defaultTo(sql`now()`).notNull())
      .addColumn('updated_at', 'timestamptz')
      .addColumn('_deleted', 'boolean', col => col.defaultTo(false).notNull())
      .execute()

    await db.schema
      .createTable('extensions.gcs_gcforms_connections')
      .addColumn('id', 'bigserial', col => col.primaryKey())
      .addColumn('agency_id', 'bigint', col => col.notNull().references('Agency_Profile.id').onDelete('restrict'))
      .addColumn('stream_id', 'bigint', col => col.notNull().references('Transfer_Payment_Stream.id').onDelete('restrict'))
      .addColumn('credential_id', 'varchar(120)', col => col.notNull())
      .addColumn('credential_revision', 'integer', col => col.notNull())
      .addColumn('secret_entry_id', 'bigint', col => col.notNull().references('extensions.secret_entry.id').onDelete('restrict'))
      .addColumn('secret_updated_at', 'timestamptz', col => col.notNull())
      .addColumn('form_id', 'varchar(80)', col => col.notNull())
      .addColumn('api_url', 'text', col => col.notNull())
      .addColumn('identity_provider_url', 'text', col => col.notNull())
      .addColumn('project_identifier', 'varchar(80)', col => col.notNull())
      .addColumn('contact_email', 'varchar(320)')
      .addColumn('preferred_language', 'varchar(2)', col => col.defaultTo('en').notNull())
      .addColumn('status', 'varchar(30)', col => col.defaultTo('active').notNull())
      .addColumn('last_template_refresh_at', 'timestamptz')
      .addColumn('created_at', 'timestamptz', col => col.defaultTo(sql`now()`).notNull())
      .addColumn('updated_at', 'timestamptz')
      .addColumn('_deleted', 'boolean', col => col.defaultTo(false).notNull())
      .addCheckConstraint('gcs_gcforms_connection_language', sql`preferred_language IN ('en', 'fr')`)
      .execute()

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
    `.execute(db)

    await db.schema
      .createTable('extensions.gcs_gcforms_templates')
      .addColumn('id', 'bigserial', col => col.primaryKey())
      .addColumn('connection_id', 'bigint', col => col.notNull().references('extensions.gcs_gcforms_connections.id').onDelete('restrict'))
      .addColumn('form_id', 'varchar(80)', col => col.notNull())
      .addColumn('title_en', 'text')
      .addColumn('title_fr', 'text')
      .addColumn('template', 'jsonb', col => col.notNull())
      .addColumn('field_catalog', 'jsonb', col => col.notNull())
      .addColumn('refreshed_at', 'timestamptz', col => col.defaultTo(sql`now()`).notNull())
      .addColumn('_deleted', 'boolean', col => col.defaultTo(false).notNull())
      .execute()

    await sql`
      CREATE UNIQUE INDEX gcs_gcforms_template_connection
      ON extensions.gcs_gcforms_templates (connection_id)
      WHERE _deleted = false
    `.execute(db)

    await db.schema
      .createTable('extensions.gcs_gcforms_integrations')
      .addColumn('id', 'bigserial', col => col.primaryKey())
      .addColumn('connection_id', 'bigint', col => col.notNull().references('extensions.gcs_gcforms_connections.id').onDelete('restrict'))
      .addColumn('stream_id', 'bigint', col => col.notNull().references('Transfer_Payment_Stream.id').onDelete('restrict'))
      .addColumn('name_en', 'varchar(200)', col => col.notNull())
      .addColumn('name_fr', 'varchar(200)', col => col.notNull())
      .addColumn('enabled', 'boolean', col => col.defaultTo(true).notNull())
      .addColumn('config_fingerprint', 'varchar(64)', col => col.notNull())
      .addColumn('config', 'jsonb', col => col.notNull())
      .addColumn('created_at', 'timestamptz', col => col.defaultTo(sql`now()`).notNull())
      .addColumn('updated_at', 'timestamptz')
      .addColumn('_deleted', 'boolean', col => col.defaultTo(false).notNull())
      .execute()

    await sql`
      CREATE UNIQUE INDEX gcs_gcforms_integration_identity
      ON extensions.gcs_gcforms_integrations (connection_id, config_fingerprint)
      WHERE _deleted = false
    `.execute(db)

    await db.schema
      .createTable('extensions.gcs_gcforms_field_mappings')
      .addColumn('id', 'bigserial', col => col.primaryKey())
      .addColumn('integration_id', 'bigint', col => col.notNull().references('extensions.gcs_gcforms_integrations.id').onDelete('restrict'))
      .addColumn('mapping_key', 'varchar(120)', col => col.notNull())
      .addColumn('source_question_id', 'varchar(200)', col => col.notNull())
      .addColumn('destination_entity', 'varchar(60)', col => col.notNull())
      .addColumn('destination_path', 'varchar(240)', col => col.notNull())
      .addColumn('transform', 'varchar(40)', col => col.notNull())
      .addColumn('required', 'boolean', col => col.defaultTo(false).notNull())
      .addColumn('default_value', 'jsonb')
      .addColumn('on_missing', 'varchar(20)', col => col.defaultTo('block').notNull())
      .addColumn('on_invalid', 'varchar(20)', col => col.defaultTo('block').notNull())
      .addColumn('_deleted', 'boolean', col => col.defaultTo(false).notNull())
      .execute()

    await sql`
      CREATE UNIQUE INDEX gcs_gcforms_mapping_key
      ON extensions.gcs_gcforms_field_mappings (integration_id, mapping_key)
      WHERE _deleted = false
    `.execute(db)

    await db.schema
      .createTable('extensions.gcs_gcforms_submissions')
      .addColumn('id', 'bigserial', col => col.primaryKey())
      .addColumn('connection_id', 'bigint', col => col.notNull().references('extensions.gcs_gcforms_connections.id').onDelete('restrict'))
      .addColumn('integration_id', 'bigint', col => col.references('extensions.gcs_gcforms_integrations.id').onDelete('restrict'))
      .addColumn('form_id', 'varchar(80)', col => col.notNull())
      .addColumn('submission_name', 'varchar(80)', col => col.notNull())
      .addColumn('gcforms_created_at', 'timestamptz')
      .addColumn('status', 'varchar(40)', col => col.notNull())
      .addColumn('confirmation_code', 'varchar(80)')
      .addColumn('answers', 'jsonb')
      .addColumn('answers_checksum', 'varchar(80)')
      .addColumn('mapped_values', 'jsonb')
      .addColumn('mapping_issues', 'jsonb')
      .addColumn('last_error', 'text')
      .addColumn('confirmed_at', 'timestamptz')
      .addColumn('created_at', 'timestamptz', col => col.defaultTo(sql`now()`).notNull())
      .addColumn('updated_at', 'timestamptz')
      .addColumn('_deleted', 'boolean', col => col.defaultTo(false).notNull())
      .execute()

    await sql`
      CREATE UNIQUE INDEX gcs_gcforms_submission_unique
      ON extensions.gcs_gcforms_submissions (connection_id, submission_name)
      WHERE _deleted = false
    `.execute(db)

    await db.schema
      .createTable('extensions.gcs_gcforms_attachments')
      .addColumn('id', 'bigserial', col => col.primaryKey())
      .addColumn('submission_id', 'bigint', col => col.notNull().references('extensions.gcs_gcforms_submissions.id').onDelete('restrict'))
      .addColumn('gcforms_attachment_id', 'varchar(120)')
      .addColumn('file_name', 'text', col => col.notNull())
      .addColumn('source_url', 'text')
      .addColumn('storage_path', 'text')
      .addColumn('md5', 'varchar(80)')
      .addColumn('is_potentially_malicious', 'boolean', col => col.defaultTo(false).notNull())
      .addColumn('downloaded_at', 'timestamptz')
      .addColumn('_deleted', 'boolean', col => col.defaultTo(false).notNull())
      .execute()

    await db.schema
      .createTable('extensions.gcs_gcforms_import_runs')
      .addColumn('id', 'bigserial', col => col.primaryKey())
      .addColumn('connection_id', 'bigint', col => col.notNull().references('extensions.gcs_gcforms_connections.id').onDelete('restrict'))
      .addColumn('integration_id', 'bigint', col => col.references('extensions.gcs_gcforms_integrations.id').onDelete('restrict'))
      .addColumn('status', 'varchar(40)', col => col.notNull())
      .addColumn('started_at', 'timestamptz', col => col.defaultTo(sql`now()`).notNull())
      .addColumn('finished_at', 'timestamptz')
      .addColumn('discovered_count', 'integer', col => col.defaultTo(0).notNull())
      .addColumn('imported_count', 'integer', col => col.defaultTo(0).notNull())
      .addColumn('problem_count', 'integer', col => col.defaultTo(0).notNull())
      .addColumn('error_message', 'text')
      .addColumn('_deleted', 'boolean', col => col.defaultTo(false).notNull())
      .execute()

    await db.schema
      .createTable('extensions.gcs_gcforms_destination_links')
      .addColumn('id', 'bigserial', col => col.primaryKey())
      .addColumn('submission_id', 'bigint', col => col.notNull().references('extensions.gcs_gcforms_submissions.id').onDelete('restrict'))
      .addColumn('mapping_id', 'bigint', col => col.references('extensions.gcs_gcforms_field_mappings.id').onDelete('restrict'))
      .addColumn('owner_type', 'varchar(80)', col => col.notNull())
      .addColumn('owner_id', 'bigint', col => col.notNull())
      .addColumn('destination_entity', 'varchar(60)', col => col.notNull())
      .addColumn('destination_path', 'varchar(240)', col => col.notNull())
      .addColumn('value', 'jsonb')
      .addColumn('_deleted', 'boolean', col => col.defaultTo(false).notNull())
      .execute()

    await db.schema
      .createTable('extensions.gcs_gcforms_materialization_overrides')
      .addColumn('id', 'bigserial', col => col.primaryKey())
      .addColumn('submission_id', 'bigint', col => col.notNull().references('extensions.gcs_gcforms_submissions.id').onDelete('restrict'))
      .addColumn('destination_entity', 'varchar(60)', col => col.notNull())
      .addColumn('destination_path', 'varchar(240)', col => col.notNull())
      .addColumn('owner_type', 'varchar(80)', col => col.notNull())
      .addColumn('owner_id', 'bigint', col => col.notNull())
      .addColumn('created_at', 'timestamptz', col => col.defaultTo(sql`now()`).notNull())
      .addColumn('updated_at', 'timestamptz')
      .addColumn('_deleted', 'boolean', col => col.defaultTo(false).notNull())
      .execute()

    await sql`
      CREATE UNIQUE INDEX gcs_gcforms_materialization_override_target
      ON extensions.gcs_gcforms_materialization_overrides (submission_id, destination_entity, destination_path)
      WHERE _deleted = false
    `.execute(db)
  }
})
