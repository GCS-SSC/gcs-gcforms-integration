import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { setEncryptedExtensionSecret } from '@gcs-ssc/extensions/server'
import type { GcFormsIntegrationHostDatabase } from '../../server/db'
import { gcFormsJsonbValue } from '../../server/jsonb'
import {
  createConfiguredClient,
  ensureConnection,
  ensureIntegration,
  getStreamConfig,
  refreshTemplate,
  syncStream
} from '../../server/runtime'
import { GCFORMS_EXTENSION_KEY, parseGcFormsStreamConfig } from '../../shared/gcforms'

type TestDb = Kysely<GcFormsIntegrationHostDatabase>

let db: TestDb
let previousRootKey: string | undefined
const rootKey = Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64')

const privateKeyPem = () => generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  },
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  }
}).privateKey

const initialTemplate = {
  titleEn: 'Claims',
  titleFr: 'Reclamations',
  elements: [
    {
      id: 1,
      type: 'textField',
      properties: {
        questionId: 'agreement_number',
        titleEn: 'Agreement number',
        validation: { required: true }
      }
    },
    {
      id: 2,
      type: 'textField',
      properties: {
        questionId: 'fiscal_year',
        titleEn: 'Fiscal year',
        validation: { required: true }
      }
    },
    {
      id: 3,
      type: 'textField',
      properties: {
        questionId: 'claim_period_start_month',
        titleEn: 'Claim period start month',
        validation: { required: true }
      }
    },
    {
      id: 4,
      type: 'textField',
      properties: {
        questionId: 'claim_period_end_month',
        titleEn: 'Claim period end month',
        validation: { required: true }
      }
    },
    {
      id: 5,
      type: 'dynamicRow',
      properties: {
        questionId: 'submitted_line_items',
        titleEn: 'Submitted claim items',
        validation: { required: true }
      },
      elements: [
        { id: 501, type: 'dropdown', properties: { questionId: 'submitted_cost_category', titleEn: 'Cost category' } },
        { id: 502, type: 'dropdown', properties: { questionId: 'submitted_cost_subsection', titleEn: 'Cost subsection' } },
        { id: 503, type: 'dropdown', properties: { questionId: 'submitted_line_item', titleEn: 'Line item' } },
        { id: 504, type: 'textField', properties: { questionId: 'submitted_amount', titleEn: 'Submitted amount' } }
      ]
    }
  ]
}

const changedTemplate = {
  ...initialTemplate,
  elements: [
    {
      id: 1,
      type: 'number',
      properties: {
        questionId: 'agreement_number',
        titleEn: 'Agreement number',
        validation: { required: true }
      }
    },
    ...initialTemplate.elements.slice(1)
  ]
}

const createSchema = async () => {
  await sql`CREATE SCHEMA extensions`.execute(db)
  await sql`
    CREATE TABLE "Transfer_Payment_Profile" (
      id bigserial PRIMARY KEY,
      egcs_tp_agency bigint NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE "Transfer_Payment_Stream" (
      id bigserial PRIMARY KEY,
      egcs_tp_transferpaymentprofile bigint NOT NULL,
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
    CREATE TABLE extensions.stream_configuration (
      id bigserial PRIMARY KEY,
      extension_key varchar(120) NOT NULL,
      stream_id bigint NOT NULL,
      enabled boolean DEFAULT false NOT NULL,
      config jsonb DEFAULT '{}'::jsonb NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE extensions.gcs_gcforms_credentials (
      id bigserial PRIMARY KEY,
      agency_id bigint NOT NULL,
      name_en varchar(200) NOT NULL,
      name_fr varchar(200) NOT NULL,
      key_id varchar(200) NOT NULL,
      user_id varchar(200) NOT NULL,
      form_id varchar(80) NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE extensions.secret_entry (
      id bigserial PRIMARY KEY,
      extension_key varchar(120) NOT NULL,
      owner_type varchar(80) NOT NULL,
      owner_id varchar(120) NOT NULL,
      secret_key varchar(160) NOT NULL,
      ciphertext text NOT NULL,
      iv text NOT NULL,
      auth_tag text NOT NULL,
      algorithm varchar(40) NOT NULL,
      key_version integer NOT NULL,
      metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE extensions.gcs_gcforms_connections (
      id bigserial PRIMARY KEY,
      agency_id bigint NOT NULL,
      stream_id bigint NOT NULL,
      credential_id varchar(120) NOT NULL,
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
    CREATE TABLE extensions.gcs_gcforms_templates (
      id bigserial PRIMARY KEY,
      connection_id bigint NOT NULL,
      form_id varchar(80) NOT NULL,
      title_en text,
      title_fr text,
      template jsonb NOT NULL,
      field_catalog jsonb NOT NULL,
      refreshed_at timestamptz DEFAULT now() NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE extensions.gcs_gcforms_integrations (
      id bigserial PRIMARY KEY,
      connection_id bigint NOT NULL,
      stream_id bigint NOT NULL,
      name_en varchar(200) NOT NULL,
      name_fr varchar(200) NOT NULL,
      enabled boolean DEFAULT true NOT NULL,
      config jsonb NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
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
  `.execute(db)
  await sql`
    CREATE TABLE extensions.gcs_gcforms_import_runs (
      id bigserial PRIMARY KEY,
      connection_id bigint NOT NULL,
      integration_id bigint,
      status varchar(40) NOT NULL,
      started_at timestamptz DEFAULT now() NOT NULL,
      finished_at timestamptz,
      discovered_count integer DEFAULT 0 NOT NULL,
      imported_count integer DEFAULT 0 NOT NULL,
      problem_count integer DEFAULT 0 NOT NULL,
      error_message text,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
}

const seedConfig = async () => {
  await db
    .insertInto('Transfer_Payment_Profile')
    .values({
      id: '10',
      egcs_tp_agency: '20',
      _deleted: false
    })
    .execute()
  await db
    .insertInto('Transfer_Payment_Stream')
    .values({
      id: '30',
      egcs_tp_transferpaymentprofile: '10',
      _deleted: false
    })
    .execute()
  await db
    .insertInto('extensions.agency_enablement')
    .values({
      extension_key: GCFORMS_EXTENSION_KEY,
      agency_id: '20',
      enabled: true,
      config: {
        apiUrl: 'https://api.example.test/v1'
      },
      _deleted: false
    })
    .execute()
  await db
    .insertInto('extensions.stream_configuration')
    .values({
      extension_key: GCFORMS_EXTENSION_KEY,
      stream_id: '30',
      enabled: true,
      config: {
        credentialId: '1',
        mappings: []
      },
      _deleted: false
    })
    .execute()
  await db
    .insertInto('extensions.gcs_gcforms_credentials')
    .values({
      id: '1',
      agency_id: '20',
      name_en: 'Claims',
      name_fr: 'Reclamations',
      key_id: 'key-1',
      user_id: 'user-1',
      form_id: 'form-1',
      _deleted: false
    })
    .execute()
  await setEncryptedExtensionSecret(db, {
    rootKey,
    extensionKey: GCFORMS_EXTENSION_KEY,
    ownerType: 'agency',
    ownerId: '20',
    secretKey: '1',
    value: {
      key: privateKeyPem()
    }
  })
}

beforeEach(async () => {
  previousRootKey = process.env.GCS_EXTENSION_SECRETS_KEY
  process.env.GCS_EXTENSION_SECRETS_KEY = rootKey
  const pglite = await KyselyPGlite.create(`memory://gcforms-template-shape-${Date.now()}`)
  db = new Kysely<GcFormsIntegrationHostDatabase>({ dialect: pglite.dialect })
  await createSchema()
  await seedConfig()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  if (previousRootKey === undefined) {
    delete process.env.GCS_EXTENSION_SECRETS_KEY
  } else {
    process.env.GCS_EXTENSION_SECRETS_KEY = previousRootKey
  }
  await db.destroy()
})

describe('GC Forms template shape guard', () => {
  it('serializes JSONB values as Postgres parameters without changing array or object shape', async () => {
    const postgresDb: Kysely<Record<string, never>> = new Kysely({
      dialect: new PostgresDialect({
        pool: {
          connect: async () => {
            throw new Error('Compile-only PostgreSQL pool cannot execute queries.')
          },
          end: async () => {}
        }
      })
    })

    try {
      const values = [
        [],
        [{ mappingId: 'mapping-1', value: true }],
        { answers: ['one', 'two'] }
      ]

      for (const value of values) {
        const compiled = sql`select ${gcFormsJsonbValue(value)}`.compile(postgresDb)
        expect(compiled.sql).toBe('select $1::jsonb')
        expect(compiled.parameters).toEqual([JSON.stringify(value)])
        expect(JSON.parse(String(compiled.parameters[0]))).toEqual(value)
      }

      const normalizedSpecialValues = sql`select ${gcFormsJsonbValue({
        bigint: 9007199254740993n,
        date: new Date('2026-01-02T03:04:05.000Z'),
        invalidDate: new Date(Number.NaN),
        nested: [undefined, Number.NaN, Number.POSITIVE_INFINITY]
      })}`.compile(postgresDb)
      expect(normalizedSpecialValues).toMatchObject({
        sql: 'select $1::jsonb',
        parameters: [JSON.stringify({
          bigint: '9007199254740993',
          date: '2026-01-02T03:04:05.000Z',
          invalidDate: null,
          nested: [null, null, null]
        })]
      })

      const sqlNull = sql`select ${gcFormsJsonbValue(undefined)}`.compile(postgresDb)
      expect(sqlNull).toMatchObject({
        sql: 'select $1',
        parameters: [null]
      })

      const jsonNull = sql`select ${gcFormsJsonbValue(null)}`.compile(postgresDb)
      expect(jsonNull).toMatchObject({
        sql: 'select $1::jsonb',
        parameters: ['null']
      })

      const roundTrip = await sql<{
        empty_value: unknown
        populated_value: unknown
      }>`select
        ${gcFormsJsonbValue([])} as empty_value,
        ${gcFormsJsonbValue([{ mappingId: 'mapping-1', value: true }])} as populated_value
      `.execute(db)
      expect(roundTrip.rows[0]).toEqual({
        empty_value: [],
        populated_value: [{ mappingId: 'mapping-1', value: true }]
      })
    } finally {
      await postgresDb.destroy()
    }
  })

  it('fails with incomplete config when no credential id is selected', async () => {
    await db
      .updateTable('extensions.stream_configuration')
      .set({
        config: {
          mappings: []
        }
      })
      .where('stream_id', '=', '30')
      .where('extension_key', '=', GCFORMS_EXTENSION_KEY)
      .execute()

    await expect(getStreamConfig(db, '30')).rejects.toMatchObject({
      code: 'GCS_GCFORMS_CONFIG_INCOMPLETE'
    })
  })

  it('rejects direct client creation with incomplete config before accessing the database', async () => {
    let databaseAccessCount = 0
    const inaccessibleDb = new Proxy({}, {
      get: () => {
        databaseAccessCount += 1
        throw new Error('Database should not be accessed for incomplete configuration.')
      }
    })

    await expect(createConfiguredClient(
      inaccessibleDb,
      '30',
      parseGcFormsStreamConfig({})
    )).rejects.toMatchObject({
      code: 'GCS_GCFORMS_CONFIG_INCOMPLETE'
    })
    expect(databaseAccessCount).toBe(0)
  })

  it('overrides submission confirmation only when agency configuration declares it', async () => {
    await db
      .updateTable('extensions.stream_configuration')
      .set({
        config: {
          credentialId: '1',
          confirmSubmissions: true,
          mappings: []
        }
      })
      .where('stream_id', '=', '30')
      .where('extension_key', '=', GCFORMS_EXTENSION_KEY)
      .execute()

    await expect(getStreamConfig(db, '30')).resolves.toMatchObject({
      confirmSubmissions: true
    })

    await db
      .updateTable('extensions.agency_enablement')
      .set({
        config: {
          confirmSubmissions: false
        }
      })
      .where('agency_id', '=', '20')
      .where('extension_key', '=', GCFORMS_EXTENSION_KEY)
      .execute()

    await expect(getStreamConfig(db, '30')).resolves.toMatchObject({
      confirmSubmissions: false
    })
  })

  it('updates an existing connection using the generated bigint id', async () => {
    await db
      .insertInto('extensions.gcs_gcforms_connections')
      .values({
        agency_id: '20',
        stream_id: '30',
        credential_id: '1',
        form_id: 'form-1',
        api_url: 'https://old.example.test/v1',
        identity_provider_url: 'https://old-idp.example.test',
        project_identifier: 'old-project',
        contact_email: null,
        preferred_language: 'en',
        status: 'active',
        _deleted: false
      })
      .execute()

    await expect(ensureConnection(db, '30', {
      credentialId: '1',
      apiUrl: 'https://api.example.test/v1',
      identityProviderUrl: 'https://idp.example.test',
      preferredLanguage: 'fr',
      mappings: []
    })).resolves.toMatchObject({
      credential_id: '1',
      form_id: 'form-1',
      identity_provider_url: 'https://idp.example.test',
      preferred_language: 'fr'
    })

    await expect(db
      .selectFrom('extensions.gcs_gcforms_connections')
      .select(db.fn.countAll().as('count'))
      .where('stream_id', '=', '30')
      .where('form_id', '=', 'form-1')
      .where('_deleted', '=', false)
      .executeTakeFirstOrThrow()).resolves.toMatchObject({ count: 1 })
  })

  it('records selected credential id and selected credential form id', async () => {
    await db
      .insertInto('extensions.gcs_gcforms_credentials')
      .values({
        id: '2',
        agency_id: '20',
        name_en: 'Claims test',
        name_fr: 'Reclamations test',
        key_id: 'key-2',
        user_id: 'user-2',
        form_id: 'form-2',
        _deleted: false
      })
      .execute()
    await setEncryptedExtensionSecret(db, {
      rootKey,
      extensionKey: GCFORMS_EXTENSION_KEY,
      ownerType: 'agency',
      ownerId: '20',
      secretKey: '2',
      value: {
        key: privateKeyPem()
      }
    })

    await expect(ensureConnection(db, '30', {
      credentialId: '2',
      preferredLanguage: 'en',
      mappings: []
    })).resolves.toMatchObject({
      credential_id: '2',
      form_id: 'form-2'
    })
  })

  it('replaces existing mappings when ensuring the same integration again', async () => {
    const connection = await ensureConnection(db, '30', {
      credentialId: '1',
      preferredLanguage: 'en',
      mappings: []
    })
    const config = {
      credentialId: '1',
      mappings: [
        {
          id: 'agreement-number',
          sourceQuestionId: 'agreement_number',
          destinationEntity: 'claim' as const,
          destinationPath: 'egcs_fc_fundingagreement',
          transform: 'string' as const,
          required: true,
          defaultValue: null,
          onMissing: 'block' as const,
          onInvalid: 'block' as const
        }
      ]
    }

    const first = await ensureIntegration(db, '30', String(connection.id), config)
    await ensureIntegration(db, '30', String(connection.id), {
      ...config,
      mappings: [
        {
          id: 'agreement-number',
          sourceQuestionId: 'agreement_number_updated',
          destinationEntity: 'claim',
          destinationPath: 'egcs_fc_fundingagreement',
          transform: 'string',
          required: true,
          onMissing: 'block',
          onInvalid: 'block'
        }
      ]
    })

    await expect(db
      .selectFrom('extensions.gcs_gcforms_field_mappings')
      .select([
        'source_question_id',
        'default_value',
        sql<boolean>`default_value IS NULL`.as('default_value_is_sql_null'),
        sql<string | null>`jsonb_typeof(default_value)`.as('default_value_json_type'),
        '_deleted'
      ])
      .where('integration_id', '=', String(first.id))
      .orderBy('id')
      .execute()).resolves.toEqual([
      expect.objectContaining({
        source_question_id: 'agreement_number',
        default_value: null,
        default_value_is_sql_null: false,
        default_value_json_type: 'null',
        _deleted: true
      }),
      expect.objectContaining({
        source_question_id: 'agreement_number_updated',
        default_value: null,
        default_value_is_sql_null: true,
        default_value_json_type: null,
        _deleted: false
      })
    ])

    const storedIntegration = await db
      .selectFrom('extensions.gcs_gcforms_integrations')
      .select('config')
      .where('id', '=', String(first.id))
      .executeTakeFirstOrThrow()
    expect(storedIntegration).toEqual({
      config: expect.objectContaining({
        credentialId: '1',
        mappings: [expect.objectContaining({
          sourceQuestionId: 'agreement_number_updated'
        })]
      })
    })
    expect(parseGcFormsStreamConfig(storedIntegration.config).mappings[0])
      .not.toHaveProperty('defaultValue')
  })

  it('blocks sync when the remote template shape changed until the user refreshes the stored baseline', async () => {
    let currentTemplate = initialTemplate
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/oauth/v2/token')) {
        return new Response(JSON.stringify({ access_token: 'token-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }

      if (url.endsWith('/forms/form-1/template')) {
        return new Response(JSON.stringify(currentTemplate), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }

      if (url.endsWith('/forms/form-1/submission/new')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }

      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)

    await refreshTemplate(db, '30')

    currentTemplate = changedTemplate
    await expect(syncStream(db, '30')).rejects.toMatchObject({
      code: 'GCS_GCFORMS_TEMPLATE_CHANGED'
    })
    await expect(db
      .selectFrom('extensions.stream_configuration')
      .select('config')
      .where('stream_id', '=', '30')
      .executeTakeFirstOrThrow()).resolves.toEqual({
      config: expect.objectContaining({
        templateShapeChanged: true
      })
    })

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/forms/form-1/submission/new'),
      expect.anything()
    )
    await expect(db
      .selectFrom('extensions.gcs_gcforms_import_runs')
      .select(db.fn.countAll().as('count'))
      .executeTakeFirstOrThrow()).resolves.toMatchObject({ count: 0 })

    await refreshTemplate(db, '30')
    await expect(db
      .selectFrom('extensions.stream_configuration')
      .select('config')
      .where('stream_id', '=', '30')
      .executeTakeFirstOrThrow()).resolves.toEqual({
      config: expect.objectContaining({
        templateShapeChanged: false
      })
    })
    await expect(syncStream(db, '30')).resolves.toMatchObject({
      discovered: 0,
      imported: 0,
      problems: 0
    })
  })
})
