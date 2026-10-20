import { describe, expect, it } from 'vitest'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import extensionDefinition from '../../extension.config'
import integrationMigration from '../../server/migrations/0001_gcforms_integration'
import claimMigration from '../../server/migrations/0002_claim_submission_uuid'
import identityMigration from '../../server/migrations/0003_credential_identity_upgrade'

describe('GC Forms fresh database naming', () => {
  it('uses the extension identity for physical tables without truncating emitted identifiers', async () => {
    const executedSql: string[] = []
    const pglite = await KyselyPGlite.create()
    const db = new Kysely({
      dialect: pglite.dialect,
      log: event => {
        if (event.level === 'query') executedSql.push(event.query.sql)
      }
    })
    try {
      await sql`CREATE SCHEMA extensions`.execute(db)
      await sql`CREATE TABLE "Agency_Profile" (id bigserial PRIMARY KEY)`.execute(db)
      await sql`CREATE TABLE "Transfer_Payment_Stream" (id bigserial PRIMARY KEY)`.execute(db)
      await sql`CREATE TABLE "Funding_Case_Agreement_Claim" (id bigserial PRIMARY KEY, _deleted boolean NOT NULL DEFAULT false)`.execute(db)
      await sql`CREATE TABLE extensions.secret_entry (
        id bigserial PRIMARY KEY, extension_key text, owner_type text, owner_id text,
        secret_key text, created_at timestamptz, updated_at timestamptz, _deleted boolean
      )`.execute(db)
      for (const migration of [integrationMigration, claimMigration, identityMigration]) {
        await migration.up(db as never)
      }
      const tables = await sql<{ tablename: string }>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'extensions' AND tablename <> 'secret_entry'
        ORDER BY tablename
      `.execute(db)
      const prefix = `${extensionDefinition.key.replaceAll('-', '_')}_`
      expect(tables.rows).toHaveLength(10)
      expect(tables.rows.every(row => row.tablename.startsWith(prefix))).toBe(true)
      expect(tables.rows.map(row => `extensions.${row.tablename}`)).toEqual(
        extensionDefinition.auditOwnership?.map(declaration => declaration.table).sort()
      )
      const oversizedIdentifiers = executedSql.flatMap(statement =>
        [...statement.matchAll(/"([^"]+)"|(?:CREATE\s+(?:UNIQUE\s+)?INDEX|ADD\s+CONSTRAINT)\s+([a-z_][a-z_0-9]*)/gi)]
          .map(match => match[1] ?? match[2] ?? '')
          .filter(identifier => Buffer.byteLength(identifier) > 63)
      )
      expect(oversizedIdentifiers).toEqual([])
      const implicitConstraints = await sql<{ table_name: string, constraint_name: string, column_names: string[], constraint_type: string }>`
        SELECT relation.relname AS table_name, constraint_row.conname AS constraint_name,
          constraint_row.contype AS constraint_type,
          array_agg(attribute.attname ORDER BY key.ordinality) AS column_names
        FROM pg_constraint constraint_row
        JOIN pg_class relation ON relation.oid = constraint_row.conrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        CROSS JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute attribute ON attribute.attrelid = relation.oid AND attribute.attnum = key.attnum
        WHERE namespace.nspname = 'extensions' AND constraint_row.contype IN ('f', 'u', 'p')
        GROUP BY relation.relname, constraint_row.conname, constraint_row.contype
      `.execute(db)
      for (const constraint of implicitConstraints.rows) {
        const suffix = constraint.constraint_type === 'f' ? 'fkey' : constraint.constraint_type === 'u' ? 'key' : 'pkey'
        const columns = constraint.constraint_type === 'p' ? '' : `${constraint.column_names.join('_')}_`
        const generatedName = `${constraint.table_name}_${columns}${suffix}`
        if (Buffer.byteLength(generatedName) > 63) {
          expect(constraint.constraint_name).toMatch(/^gcs_gcforms_(?:fk|uq|pk)_/)
        }
      }
      const foreignKeys = await sql<{ conname: string }>`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'extensions.gcs_gcforms_integration_materialization_overrides'::regclass
          AND contype = 'f'
      `.execute(db)
      expect(foreignKeys.rows).toEqual([{ conname: 'gcs_gcforms_fk_override_submission' }])
    } finally {
      await db.destroy()
    }
  })
})
