import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { setEncryptedExtensionSecret } from '@gcs-ssc/extensions/server'
import type { GcFormsIntegrationHostDatabase } from '../../server/db'
import { deleteGcFormsCredential, patchGcFormsCredential } from '../../server/credentials'
import { GcFormsApiClient } from '../../server/gcforms-client'
import { guardGcFormsLifecycleChange } from '../../server/plugins/lifecycle-guards'
import { gcFormsJsonbValue } from '../../server/jsonb'
import {
  createConfiguredClient,
  ensureConnection,
  ensureIntegration,
  getGcFormsCredential,
  getStreamConfig,
  persistGcFormsTemplateShapeChangedForSession,
  GCFORMS_SYNC_BATCH_LIMIT,
  reconcileDisabledGcFormsConfirmations,
  reconcileGcFormsSubmissionConfirmation,
  refreshTemplate,
  syncStream
} from '../../server/runtime'
import { GCFORMS_EXTENSION_KEY, parseGcFormsStreamConfig } from '../../shared/gcforms'

type TestDb = Kysely<GcFormsIntegrationHostDatabase>

let db: TestDb
let previousRootKey: string | undefined
const rootKey = Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64')

const createSyncContext = () => ({
  db,
  stream: { agencyId: '20' },
  writeAuthorization: {
    lockAuthState: async () => undefined,
    authorizeCurrentScope: async () => undefined,
    authorizeCurrentEntity: async () => undefined,
    lockAndAuthorizeAgreement: async () => true
  }
}) as any

const createRouteSyncEvent = () => {
  const auth = {
    userId: 'user-1',
    userAbilities: {
      authorize: () => true
    }
  }
  const syncContext = createSyncContext()
  return {
    context: {
      $db: db,
      params: { streamId: '30' },
      $authContext: auth,
      gcsExtension: {
        extensionKey: GCFORMS_EXTENSION_KEY,
        stream: syncContext.stream,
        writeAuthorization: syncContext.writeAuthorization
      }
    }
  } as any
}

const createCredentialContext = (credentialId: string, body: unknown = {}) => ({
  ...createSyncContext(),
  params: { agencyId: '20', credentialId },
  agency: { agencyId: '20' },
  auth: {
    userId: 'user-1',
    userAbilities: {
      authorize: () => true
    }
  },
  readBody: async () => body
}) as any

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
    CREATE TABLE "Agency_Profile" (
      id bigserial PRIMARY KEY,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
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
      revision integer DEFAULT 1 NOT NULL,
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
      config_fingerprint varchar(64) NOT NULL,
      config jsonb NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE UNIQUE INDEX gcs_gcforms_integration_identity
    ON extensions.gcs_gcforms_integrations (connection_id, config_fingerprint)
    WHERE _deleted = false
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
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE extensions.gcs_gcforms_submissions (
      id bigserial PRIMARY KEY,
      connection_id bigint NOT NULL,
      integration_id bigint,
      form_id varchar(200) NOT NULL,
      submission_name varchar(200) NOT NULL,
      gcforms_created_at timestamptz,
      status varchar(40) NOT NULL,
      confirmation_code varchar(200),
      answers jsonb,
      answers_checksum varchar(200),
      mapped_values jsonb,
      mapping_issues jsonb,
      diagnostic_code varchar(100),
      diagnostic_params jsonb,
      confirmed_at timestamptz,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE UNIQUE INDEX gcs_gcforms_submission_unique
    ON extensions.gcs_gcforms_submissions (connection_id, submission_name)
    WHERE _deleted = false
  `.execute(db)
  await sql`
    CREATE TABLE extensions.gcs_gcforms_attachments (
      id bigserial PRIMARY KEY,
      submission_id bigint NOT NULL,
      gcforms_attachment_id varchar(120),
      file_name text NOT NULL,
      source_url text,
      storage_path text,
      md5 varchar(80),
      is_potentially_malicious boolean DEFAULT false NOT NULL,
      downloaded_at timestamptz,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
}

const seedConfig = async () => {
  await db
    .insertInto('Agency_Profile')
    .values({ id: '20', _deleted: false })
    .execute()
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
        apiUrl: 'https://api.example.test/v1',
        submissionStatusId: '91'
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

const rotateCredential = async () => {
  await db
    .insertInto('extensions.gcs_gcforms_credentials')
    .values({
      id: '2',
      agency_id: '20',
      name_en: 'Claims rotated',
      name_fr: 'Reclamations renouvelees',
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
    value: { key: privateKeyPem() }
  })
  await db
    .updateTable('extensions.stream_configuration')
    .set({
      config: {
        credentialId: '2',
        mappings: []
      }
    })
    .where('stream_id', '=', '30')
    .execute()
}

const configureMissingRequiredClaimMapping = async () => {
  await db
    .updateTable('extensions.stream_configuration')
    .set({
      config: {
        credentialId: '1',
        mappings: [{
          id: 'required-agreement',
          sourceQuestionId: 'missing_agreement_number',
          destinationEntity: 'claim',
          destinationPath: 'egcs_fc_fundingagreement',
          transform: 'string',
          required: true,
          onMissing: 'block',
          onInvalid: 'block'
        }]
      }
    })
    .where('stream_id', '=', '30')
    .execute()
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
  vi.restoreAllMocks()
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
          confirmSubmissions: false,
          submissionStatusId: '91'
        }
      })
      .where('agency_id', '=', '20')
      .where('extension_key', '=', GCFORMS_EXTENSION_KEY)
      .execute()

    await expect(getStreamConfig(db, '30')).resolves.toMatchObject({
      confirmSubmissions: false
    })
  })

  it('keeps repeated submission reads empty and strictly free of setup mutations', async () => {
    const submissionsRoute = (await import('../../server/api/submissions.get')).default as any
    const before = await Promise.all([
      db.selectFrom('extensions.gcs_gcforms_connections').select(db.fn.countAll().as('count')).executeTakeFirstOrThrow(),
      db.selectFrom('extensions.gcs_gcforms_integrations').select(db.fn.countAll().as('count')).executeTakeFirstOrThrow(),
      db.selectFrom('extensions.gcs_gcforms_field_mappings').select(db.fn.countAll().as('count')).executeTakeFirstOrThrow()
    ])

    await expect(submissionsRoute(createRouteSyncEvent())).resolves.toMatchObject({
      items: [],
      total: 0,
      stats: { total: 0, active: 0 },
      page: 1,
      limit: 10
    })
    await expect(submissionsRoute(createRouteSyncEvent())).resolves.toMatchObject({
      items: [],
      total: 0
    })
    const after = await Promise.all([
      db.selectFrom('extensions.gcs_gcforms_connections').select(db.fn.countAll().as('count')).executeTakeFirstOrThrow(),
      db.selectFrom('extensions.gcs_gcforms_integrations').select(db.fn.countAll().as('count')).executeTakeFirstOrThrow(),
      db.selectFrom('extensions.gcs_gcforms_field_mappings').select(db.fn.countAll().as('count')).executeTakeFirstOrThrow()
    ])
    expect(after).toEqual(before)
  })

  it('creates an immutable connection version when the remote identity changes', async () => {
    await db
      .insertInto('extensions.gcs_gcforms_connections')
      .values({
        agency_id: '20',
        stream_id: '30',
        credential_id: '1',
        credential_revision: 1,
        secret_entry_id: '1',
        secret_updated_at: new Date(0),
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
      .executeTakeFirstOrThrow()).resolves.toMatchObject({ count: 2 })
    await expect(db
      .selectFrom('extensions.gcs_gcforms_connections')
      .select(['api_url', 'identity_provider_url', 'project_identifier'])
      .where('api_url', '=', 'https://old.example.test/v1')
      .executeTakeFirstOrThrow()).resolves.toEqual({
      api_url: 'https://old.example.test/v1',
      identity_provider_url: 'https://old-idp.example.test',
      project_identifier: 'old-project'
    })
  })

  it('idempotently resolves concurrent creation of the same remote identity', async () => {
    const config = {
      credentialId: '1',
      apiUrl: 'https://race.example.test/v1',
      identityProviderUrl: 'https://race-idp.example.test',
      projectIdentifier: 'race-project',
      preferredLanguage: 'en' as const,
      mappings: []
    }
    const connections = await Promise.all([
      ensureConnection(db, '30', config),
      ensureConnection(db, '30', config)
    ])

    expect(String(connections[0]?.id)).toBe(String(connections[1]?.id))
    await expect(db
      .selectFrom('extensions.gcs_gcforms_connections')
      .select(db.fn.countAll().as('count'))
      .where('stream_id', '=', '30')
      .where('api_url', '=', config.apiUrl)
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

  it('versions integration mappings without mutating the earlier context', async () => {
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
    const second = await ensureIntegration(db, '30', String(connection.id), {
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
      .where('integration_id', 'in', [String(first.id), String(second.id)])
      .orderBy('id')
      .execute()).resolves.toEqual([
      expect.objectContaining({
        source_question_id: 'agreement_number',
        default_value: null,
        default_value_is_sql_null: false,
        default_value_json_type: 'null',
        _deleted: false
      }),
      expect.objectContaining({
        source_question_id: 'agreement_number_updated',
        default_value: null,
        default_value_is_sql_null: true,
        default_value_json_type: null,
        _deleted: false
      })
    ])

    const storedIntegrations = await db
      .selectFrom('extensions.gcs_gcforms_integrations')
      .select(['id', 'config'])
      .where('id', 'in', [String(first.id), String(second.id)])
      .orderBy('id')
      .execute()
    expect(storedIntegrations).toHaveLength(2)
    expect(parseGcFormsStreamConfig(storedIntegrations[0]?.config).mappings[0]).toMatchObject({
      sourceQuestionId: 'agreement_number',
      defaultValue: null
    })
    expect(parseGcFormsStreamConfig(storedIntegrations[1]?.config).mappings[0]).toMatchObject({
      sourceQuestionId: 'agreement_number_updated'
    })
    expect(parseGcFormsStreamConfig(storedIntegrations[1]?.config).mappings[0])
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
    const templateChanged = await syncStream(createSyncContext(), '30').catch((error: unknown) => error)
    expect(templateChanged).toMatchObject({
      code: 'GCS_GCFORMS_TEMPLATE_CHANGED'
    })
    await expect(persistGcFormsTemplateShapeChangedForSession(
      createSyncContext(),
      '30',
      templateChanged
    )).resolves.toBeUndefined()
    await expect(db
      .selectFrom('extensions.stream_configuration')
      .select('config')
      .where('stream_id', '=', '30')
      .executeTakeFirstOrThrow()).resolves.toEqual({
      config: expect.objectContaining({ templateShapeChanged: true })
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
    await expect(syncStream(createSyncContext(), '30')).resolves.toMatchObject({
      discovered: 0,
      imported: 0,
      problems: 0
    })
  })

  it('does not mark a replacement configuration when template drift belongs to the previous sync session', async () => {
    let currentTemplate = initialTemplate
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
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
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch)
    await refreshTemplate(db, '30')
    currentTemplate = changedTemplate

    const templateChanged = await syncStream(createSyncContext(), '30').catch((error: unknown) => error)
    expect(templateChanged).toMatchObject({
      code: 'GCS_GCFORMS_TEMPLATE_CHANGED',
      gcFormsSyncSession: {
        configFingerprint: expect.any(String),
        connectionId: expect.any(String),
        credentialId: '1'
      }
    })

    await rotateCredential()
    const replacementBefore = await db
      .selectFrom('extensions.stream_configuration')
      .select('config')
      .where('stream_id', '=', '30')
      .executeTakeFirstOrThrow()
    await expect(persistGcFormsTemplateShapeChangedForSession(
      createSyncContext(),
      '30',
      templateChanged
    )).rejects.toMatchObject({ code: 'GCS_GCFORMS_CONFIG_CHANGED' })
    await expect(db
      .selectFrom('extensions.stream_configuration')
      .select('config')
      .where('stream_id', '=', '30')
      .executeTakeFirstOrThrow()).resolves.toEqual(replacementBefore)
  })

  it('rejects prepared submissions when credential authentication changes before the local import batch', async () => {
    const replacementKey = privateKeyPem()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/oauth/v2/token')) {
        return new Response(JSON.stringify({ access_token: 'token-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/forms/form-1/template')) {
        return new Response(JSON.stringify(initialTemplate), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/forms/form-1/submission/new')) {
        return new Response(JSON.stringify([
          { name: 'prepared-before-patch', createdAt: 1725553403512 }
        ]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)
    await refreshTemplate(db, '30')

    const decryptSpy = vi
      .spyOn(GcFormsApiClient.prototype, 'getDecryptedSubmission')
      .mockImplementationOnce(async () => {
        await patchGcFormsCredential(createCredentialContext('1', { key: replacementKey }))
        return {
          createdAt: 1725553403512,
          status: 'New',
          confirmationCode: 'confirmation-1',
          answers: '{}',
          checksum: '99914b932bd37a50b983c5e7c90ae93b'
        }
      })

    await expect(syncStream(createSyncContext(), '30')).rejects.toMatchObject({
      statusCode: 409,
      code: 'GCS_GCFORMS_CONFIG_CHANGED',
      localizedMessage: {
        en: expect.stringContaining('configuration changed'),
        fr: expect.stringContaining('configuration de GC Forms a change')
      }
    })
    expect(decryptSpy).toHaveBeenCalledWith('prepared-before-patch')
    await expect(db
      .selectFrom('extensions.gcs_gcforms_import_runs')
      .select(db.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow()).resolves.toMatchObject({ count: 0 })
    await expect(db
      .selectFrom('extensions.gcs_gcforms_submissions')
      .select(db.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow()).resolves.toMatchObject({ count: 0 })
    await expect(getGcFormsCredential(db, '20', '1')).resolves.toMatchObject({ key: replacementKey })
  })

  it('decrypts selected submissions one at a time between per-submission transactions', async () => {
    await configureMissingRequiredClaimMapping()
    vi.spyOn(GcFormsApiClient.prototype, 'getFormTemplate').mockResolvedValue(initialTemplate)
    vi.spyOn(GcFormsApiClient.prototype, 'getNewSubmissions').mockResolvedValue([
      { name: 'submission-2', createdAt: 2 },
      { name: 'submission-1', createdAt: 1 }
    ])
    const observedPersistedCounts: number[] = []
    vi.spyOn(GcFormsApiClient.prototype, 'getDecryptedSubmission')
      .mockImplementation(async submissionName => {
        const persisted = await db
          .selectFrom('extensions.gcs_gcforms_submissions')
          .select(db.fn.countAll<number>().as('count'))
          .executeTakeFirstOrThrow()
        observedPersistedCounts.push(Number(persisted.count))
        return {
          createdAt: submissionName === 'submission-1' ? 1 : 2,
          status: 'New',
          confirmationCode: `confirmation-${submissionName}`,
          answers: '{}',
          checksum: '99914b932bd37a50b983c5e7c90ae93b'
        }
      })

    await refreshTemplate(db, '30')
    await expect(syncStream(createSyncContext(), '30')).resolves.toMatchObject({
      discovered: 2,
      imported: 0,
      problems: 2,
      continuationRequired: false
    })
    expect(observedPersistedCounts).toEqual([0, 1])
    await expect(db
      .selectFrom('extensions.gcs_gcforms_submissions')
      .select('submission_name')
      .orderBy('id', 'asc')
      .execute()).resolves.toEqual([
      { submission_name: 'submission-1' },
      { submission_name: 'submission-2' }
    ])
  })

  it('preserves the first committed submission when configuration drifts during a later download', async () => {
    const replacementKey = privateKeyPem()
    await configureMissingRequiredClaimMapping()
    vi.spyOn(GcFormsApiClient.prototype, 'getFormTemplate').mockResolvedValue(initialTemplate)
    vi.spyOn(GcFormsApiClient.prototype, 'getNewSubmissions').mockResolvedValue([
      { name: 'submission-1', createdAt: 1 },
      { name: 'submission-2', createdAt: 2 }
    ])
    vi.spyOn(GcFormsApiClient.prototype, 'getDecryptedSubmission')
      .mockImplementation(async submissionName => {
        if (submissionName === 'submission-2') {
          await patchGcFormsCredential(createCredentialContext('1', { key: replacementKey }))
        }
        return {
          createdAt: submissionName === 'submission-1' ? 1 : 2,
          status: 'New',
          confirmationCode: `confirmation-${submissionName}`,
          answers: '{}',
          checksum: '99914b932bd37a50b983c5e7c90ae93b'
        }
      })

    await refreshTemplate(db, '30')
    await expect(syncStream(createSyncContext(), '30')).rejects.toMatchObject({
      code: 'GCS_GCFORMS_CONFIG_CHANGED'
    })
    await expect(db
      .selectFrom('extensions.gcs_gcforms_submissions')
      .select(['submission_name', 'status'])
      .execute()).resolves.toEqual([
      { submission_name: 'submission-1', status: 'mapping_failed' }
    ])
    await expect(db
      .selectFrom('extensions.gcs_gcforms_import_runs')
      .select(['status', 'discovered_count', 'imported_count'])
      .executeTakeFirstOrThrow()).resolves.toEqual({
      status: 'failed',
      discovered_count: 2,
      imported_count: 0
    })
  })

  it('rejects an oversized encrypted response before creating local import state', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/oauth/v2/token')) {
        return new Response(JSON.stringify({ access_token: 'token-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/forms/form-1/template')) {
        return new Response(JSON.stringify(initialTemplate), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/forms/form-1/submission/new')) {
        return new Response(JSON.stringify([
          { name: 'oversized-submission', createdAt: 1 }
        ]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/forms/form-1/submission/oversized-submission')) {
        return new Response('{}', {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-length': '999999999'
          }
        })
      }
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)

    await refreshTemplate(db, '30')
    await expect(syncStream(createSyncContext(), '30')).rejects.toMatchObject({
      code: 'GCS_GCFORMS_RESPONSE_TOO_LARGE'
    })
    await expect(db
      .selectFrom('extensions.gcs_gcforms_import_runs')
      .select(db.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow()).resolves.toMatchObject({ count: 0 })
    await expect(db
      .selectFrom('extensions.gcs_gcforms_submissions')
      .select(db.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow()).resolves.toMatchObject({ count: 0 })
  })

  it('preserves and reconciles a same-connection pending marker instead of retrying failed content', async () => {
    await db
      .updateTable('extensions.agency_enablement')
      .set({
        config: {
          apiUrl: 'https://api.example.test/v1',
          confirmSubmissions: true,
          submissionStatusId: '91'
        }
      })
      .where('agency_id', '=', '20')
      .execute()
    let confirmationAttempts = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/oauth/v2/token')) {
        return new Response(JSON.stringify({ access_token: 'token-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/forms/form-1/template')) {
        return new Response(JSON.stringify(initialTemplate), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/forms/form-1/submission/new')) {
        return new Response(JSON.stringify([
          { name: 'durable-pending', createdAt: 1725553403512 }
        ]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.includes('/forms/form-1/submission/durable-pending/confirm/confirmation-1')) {
        confirmationAttempts += 1
        return new Response(null, { status: 204 })
      }
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch)
    await refreshTemplate(db, '30')
    const connection = await db
      .selectFrom('extensions.gcs_gcforms_connections')
      .select(['id', 'form_id'])
      .where('stream_id', '=', '30')
      .executeTakeFirstOrThrow()
    const integration = await db
      .selectFrom('extensions.gcs_gcforms_integrations')
      .select('id')
      .where('stream_id', '=', '30')
      .executeTakeFirstOrThrow()
    const pending = await db
      .insertInto('extensions.gcs_gcforms_submissions')
      .values({
        connection_id: String(connection.id),
        integration_id: String(integration.id),
        form_id: connection.form_id,
        submission_name: 'durable-pending',
        status: 'imported_pending_confirm',
        confirmation_code: 'confirmation-1'
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    const decryptSpy = vi
      .spyOn(GcFormsApiClient.prototype, 'getDecryptedSubmission')
      .mockResolvedValueOnce({
        createdAt: 1725553403512,
        status: 'New',
        confirmationCode: 'replacement-code-that-must-not-persist',
        answers: '{not valid json',
        checksum: 'invalid-checksum',
        attachments: [{
          id: 'malicious-attachment',
          name: 'unsafe.bin',
          downloadLink: 'https://example.test/unsafe.bin',
          isPotentiallyMalicious: true
        }]
      })

    const context = createSyncContext()
    const result = await syncStream(context, '30')
    expect(result).toMatchObject({ skipped: 1, problems: 0 })
    const reconciliation = result.pendingConfirmations.find(
      item => item.submissionId === String(pending.id)
    )
    if (!reconciliation) {
      throw new Error('Expected same-connection pending reconciliation.')
    }
    expect(decryptSpy).not.toHaveBeenCalled()
    await expect(db
      .selectFrom('extensions.gcs_gcforms_submissions')
      .select(['status', 'confirmation_code'])
      .where('id', '=', String(pending.id))
      .executeTakeFirstOrThrow()).resolves.toEqual({
      status: 'imported_pending_confirm',
      confirmation_code: 'confirmation-1'
    })
    await expect(patchGcFormsCredential(createCredentialContext('1', {
      keyId: 'blocked-while-pending'
    }))).rejects.toMatchObject({
      code: 'GCS_GCFORMS_CREDENTIAL_UPDATE_RECOVERABLE_SUBMISSIONS'
    })
    await expect(deleteGcFormsCredential(createCredentialContext('1'))).rejects.toMatchObject({
      code: 'GCS_GCFORMS_CREDENTIAL_RECOVERABLE_SUBMISSIONS'
    })

    await reconcileGcFormsSubmissionConfirmation(context, '30', reconciliation)
    expect(confirmationAttempts).toBe(1)
    await expect(db
      .selectFrom('extensions.gcs_gcforms_submissions')
      .select(['status', 'confirmation_code'])
      .where('id', '=', String(pending.id))
      .executeTakeFirstOrThrow()).resolves.toEqual({
      status: 'imported',
      confirmation_code: 'confirmation-1'
    })
  })

  it('versions changed remote identity while pending recovery keeps the original route', async () => {
    await db
      .updateTable('extensions.agency_enablement')
      .set({
        config: {
          apiUrl: 'https://old-api.example.test/v1',
          identityProviderUrl: 'https://old-idp.example.test',
          confirmSubmissions: true,
          submissionStatusId: '91'
        }
      })
      .where('agency_id', '=', '20')
      .execute()
    await db
      .updateTable('extensions.stream_configuration')
      .set({
        config: {
          credentialId: '1',
          projectIdentifier: 'old-project',
          mappings: []
        }
      })
      .where('stream_id', '=', '30')
      .execute()

    const requestedUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requestedUrls.push(url)
      if (url.endsWith('/oauth/v2/token')) {
        return new Response(JSON.stringify({ access_token: 'token-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/template')) {
        return new Response(JSON.stringify(initialTemplate), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url === 'https://old-api.example.test/v1/forms/form-1/submission/new') {
        return new Response(JSON.stringify([
          { name: 'old-route-pending', createdAt: 1725553403512 }
        ]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/submission/new')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url === 'https://old-api.example.test/v1/forms/form-1/submission/old-route-pending/confirm/old-confirmation') {
        return new Response(null, { status: 204 })
      }
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch)

    const originalRefresh = await refreshTemplate(db, '30')
    const originalConnectionId = String(originalRefresh.connection.id)
    const originalIntegration = await db
      .selectFrom('extensions.gcs_gcforms_integrations')
      .select('id')
      .where('connection_id', '=', originalConnectionId)
      .executeTakeFirstOrThrow()
    const pending = await db
      .insertInto('extensions.gcs_gcforms_submissions')
      .values({
        connection_id: originalConnectionId,
        integration_id: String(originalIntegration.id),
        form_id: 'form-1',
        submission_name: 'old-route-pending',
        status: 'imported_pending_confirm',
        confirmation_code: 'old-confirmation'
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    await db
      .updateTable('extensions.agency_enablement')
      .set({
        config: {
          apiUrl: 'https://new-api.example.test/v2',
          identityProviderUrl: 'https://new-idp.example.test',
          confirmSubmissions: true,
          submissionStatusId: '91'
        }
      })
      .where('agency_id', '=', '20')
      .execute()
    await db
      .updateTable('extensions.stream_configuration')
      .set({
        config: {
          credentialId: '1',
          projectIdentifier: 'new-project',
          mappings: []
        }
      })
      .where('stream_id', '=', '30')
      .execute()
    await db
      .updateTable('extensions.gcs_gcforms_credentials')
      .set({ form_id: 'form-2' })
      .where('id', '=', '1')
      .execute()

    const replacementRefresh = await refreshTemplate(db, '30')
    const replacementConnectionId = String(replacementRefresh.connection.id)
    expect(replacementConnectionId).not.toBe(originalConnectionId)
    const originalConnection = await db
      .selectFrom('extensions.gcs_gcforms_connections')
      .select([
        'form_id',
        'api_url',
        'identity_provider_url',
        'project_identifier',
        'credential_revision',
        'secret_entry_id'
      ])
      .where('id', '=', originalConnectionId)
      .executeTakeFirstOrThrow()
    expect(originalConnection).toMatchObject({
      form_id: 'form-1',
      api_url: 'https://old-api.example.test/v1',
      identity_provider_url: 'https://old-idp.example.test',
      project_identifier: 'old-project',
      credential_revision: 1
    })
    expect(String(originalConnection.secret_entry_id)).toBe('1')

    const invokeLifecycleGuard = async () => await db.transaction().execute(async trx => {
      await guardGcFormsLifecycleChange({
        extensionKey: GCFORMS_EXTENSION_KEY,
        scope: 'stream',
        event: {},
        db: trx as any,
        agencyId: '20',
        streamId: '30'
      })
    })
    await expect(invokeLifecycleGuard()).rejects.toMatchObject({
      code: 'GCS_GCFORMS_SCOPE_RECOVERABLE_SUBMISSIONS'
    })

    requestedUrls.length = 0
    const context = createSyncContext()
    const result = await syncStream(context, '30')
    const reconciliation = result.pendingConfirmations.find(
      item => item.submissionId === String(pending.id)
    )
    if (!reconciliation) {
      throw new Error('Expected old-route pending confirmation recovery.')
    }
    expect(reconciliation.remotelyPending).toBe(true)
    expect(requestedUrls).toContain('https://new-api.example.test/v2/forms/form-2/submission/new')
    expect(requestedUrls).toContain('https://old-api.example.test/v1/forms/form-1/submission/new')

    requestedUrls.length = 0
    await reconcileGcFormsSubmissionConfirmation(context, '30', reconciliation)
    expect(requestedUrls).toContain(
      'https://old-api.example.test/v1/forms/form-1/submission/old-route-pending/confirm/old-confirmation'
    )
    expect(requestedUrls.some(url => url.includes('new-api.example.test') && url.includes('/confirm/'))).toBe(false)
    await expect(invokeLifecycleGuard()).resolves.toBeUndefined()
  })

  it('bounds enabled historical recovery requests and continues limit plus one by persisted id', async () => {
    await db
      .updateTable('extensions.agency_enablement')
      .set({
        config: {
          apiUrl: 'https://api.example.test/v1',
          confirmSubmissions: true,
          submissionStatusId: '91'
        }
      })
      .where('agency_id', '=', '20')
      .execute()
    vi.spyOn(GcFormsApiClient.prototype, 'getFormTemplate').mockResolvedValue(initialTemplate)
    const getNewSubmissionsSpy = vi
      .spyOn(GcFormsApiClient.prototype, 'getNewSubmissions')
      .mockResolvedValue([])

    await refreshTemplate(db, '30')
    const currentConnection = await db
      .selectFrom('extensions.gcs_gcforms_connections')
      .selectAll()
      .where('stream_id', '=', '30')
      .executeTakeFirstOrThrow()
    const integration = await db
      .selectFrom('extensions.gcs_gcforms_integrations')
      .select('id')
      .where('connection_id', '=', String(currentConnection.id))
      .executeTakeFirstOrThrow()
    const historicalConnections = await db
      .insertInto('extensions.gcs_gcforms_connections')
      .values(Array.from({ length: GCFORMS_SYNC_BATCH_LIMIT + 1 }, (_, index) => ({
        agency_id: currentConnection.agency_id,
        stream_id: currentConnection.stream_id,
        credential_id: currentConnection.credential_id,
        credential_revision: currentConnection.credential_revision,
        secret_entry_id: String(currentConnection.secret_entry_id),
        secret_updated_at: currentConnection.secret_updated_at,
        form_id: currentConnection.form_id,
        api_url: currentConnection.api_url,
        identity_provider_url: currentConnection.identity_provider_url,
        project_identifier: `historical-project-${index}`,
        contact_email: null,
        preferred_language: 'en' as const,
        status: 'active',
        _deleted: false
      })))
      .returning('id')
      .execute()
    await db
      .insertInto('extensions.gcs_gcforms_submissions')
      .values(historicalConnections.map((connection, index) => ({
        connection_id: String(connection.id),
        integration_id: String(integration.id),
        form_id: currentConnection.form_id,
        submission_name: `enabled-pending-${String(index).padStart(3, '0')}`,
        status: 'imported_pending_confirm' as const,
        confirmation_code: `confirmation-${index}`
      })))
      .execute()

    getNewSubmissionsSpy.mockClear()
    const context = createSyncContext()
    const first = await syncStream(context, '30')
    expect(first.pendingConfirmations).toHaveLength(GCFORMS_SYNC_BATCH_LIMIT)
    expect(first.continuationRequired).toBe(true)
    expect(getNewSubmissionsSpy).toHaveBeenCalledTimes(GCFORMS_SYNC_BATCH_LIMIT + 1)
    for (const pending of first.pendingConfirmations) {
      expect(pending.remotelyPending).toBe(false)
      await reconcileGcFormsSubmissionConfirmation(context, '30', pending)
    }

    getNewSubmissionsSpy.mockClear()
    const second = await syncStream(context, '30')
    expect(second.pendingConfirmations).toHaveLength(1)
    expect(second.continuationRequired).toBe(false)
    expect(getNewSubmissionsSpy).toHaveBeenCalledTimes(2)
    await expect(db
      .selectFrom('extensions.gcs_gcforms_submissions')
      .select('submission_name')
      .where('status', '=', 'imported_pending_confirm')
      .executeTakeFirstOrThrow()).resolves.toEqual({
      submission_name: `enabled-pending-${String(GCFORMS_SYNC_BATCH_LIMIT).padStart(3, '0')}`
    })
  })

  it('bounds confirmation-disabled recovery and continues limit plus one in persisted id order', async () => {
    vi.spyOn(GcFormsApiClient.prototype, 'getFormTemplate').mockResolvedValue(initialTemplate)
    const remoteListSpy = vi.spyOn(GcFormsApiClient.prototype, 'getNewSubmissions')
    await refreshTemplate(db, '30')
    const connection = await db
      .selectFrom('extensions.gcs_gcforms_connections')
      .select(['id', 'form_id'])
      .where('stream_id', '=', '30')
      .executeTakeFirstOrThrow()
    const integration = await db
      .selectFrom('extensions.gcs_gcforms_integrations')
      .select('id')
      .where('connection_id', '=', String(connection.id))
      .executeTakeFirstOrThrow()
    await db
      .insertInto('extensions.gcs_gcforms_submissions')
      .values(Array.from({ length: GCFORMS_SYNC_BATCH_LIMIT + 1 }, (_, index) => ({
        connection_id: String(connection.id),
        integration_id: String(integration.id),
        form_id: connection.form_id,
        submission_name: `disabled-pending-${String(index).padStart(3, '0')}`,
        status: 'imported_pending_confirm' as const,
        confirmation_code: `confirmation-${index}`
      })))
      .execute()

    await expect(reconcileDisabledGcFormsConfirmations(createSyncContext(), '30')).resolves.toEqual({
      processed: GCFORMS_SYNC_BATCH_LIMIT,
      hasMore: true
    })
    await expect(db
      .selectFrom('extensions.gcs_gcforms_submissions')
      .select('submission_name')
      .where('status', '=', 'imported_pending_confirm')
      .executeTakeFirstOrThrow()).resolves.toEqual({
      submission_name: `disabled-pending-${String(GCFORMS_SYNC_BATCH_LIMIT).padStart(3, '0')}`
    })
    await expect(reconcileDisabledGcFormsConfirmations(createSyncContext(), '30')).resolves.toEqual({
      processed: 1,
      hasMore: false
    })
    expect(remoteListSpy).not.toHaveBeenCalled()
  })

  it('finalizes disabled-confirmation pending rows before unavailable credentials or endpoints', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/oauth/v2/token')) {
        return new Response(JSON.stringify({ access_token: 'token-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/forms/form-1/template')) {
        return new Response(JSON.stringify(initialTemplate), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)
    await refreshTemplate(db, '30')
    const connection = await db
      .selectFrom('extensions.gcs_gcforms_connections')
      .select(['id', 'form_id'])
      .where('stream_id', '=', '30')
      .executeTakeFirstOrThrow()
    const pending = await db
      .insertInto('extensions.gcs_gcforms_submissions')
      .values({
        connection_id: String(connection.id),
        integration_id: null,
        form_id: connection.form_id,
        submission_name: 'disabled-confirmation-pending',
        status: 'imported_pending_confirm',
        confirmation_code: 'confirmation-1'
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    await db
      .updateTable('extensions.agency_enablement')
      .set({
        config: {
          apiUrl: 'https://unavailable.invalid',
          confirmSubmissions: false,
          submissionStatusId: '91'
        }
      })
      .where('agency_id', '=', '20')
      .execute()
    await db
      .updateTable('extensions.secret_entry')
      .set({ _deleted: true })
      .where('secret_key', '=', '1')
      .execute()

    const invokeLifecycleGuard = async () => await db.transaction().execute(async trx => {
      await guardGcFormsLifecycleChange({
        extensionKey: GCFORMS_EXTENSION_KEY,
        scope: 'stream',
        event: {},
        db: trx as any,
        agencyId: '20',
        streamId: '30'
      })
    })
    await expect(invokeLifecycleGuard()).rejects.toMatchObject({
      code: 'GCS_GCFORMS_SCOPE_RECOVERABLE_SUBMISSIONS'
    })
    fetchMock.mockClear()

    const syncRoute = (await import('../../server/api/sync.post')).default as any
    await expect(syncRoute(createRouteSyncEvent())).rejects.toMatchObject({
      code: 'GCS_GCFORMS_CREDENTIAL_MISSING'
    })
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(db
      .selectFrom('extensions.gcs_gcforms_submissions')
      .select('status')
      .where('id', '=', String(pending.id))
      .executeTakeFirstOrThrow()).resolves.toEqual({ status: 'imported' })
    await expect(invokeLifecycleGuard()).resolves.toBeUndefined()
  })

  it('recovers remote-success/local-fail pending state through its historical credential after rotation', async () => {
    await db
      .updateTable('extensions.agency_enablement')
      .set({
        config: {
          apiUrl: 'https://api.example.test/v1',
          confirmSubmissions: true,
          submissionStatusId: '91'
        }
      })
      .where('agency_id', '=', '20')
      .execute()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/oauth/v2/token')) {
        return new Response(JSON.stringify({ access_token: 'token-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/forms/form-1/template')) {
        return new Response(JSON.stringify(initialTemplate), {
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
    }) as unknown as typeof fetch)
    await refreshTemplate(db, '30')
    const connection = await db
      .selectFrom('extensions.gcs_gcforms_connections')
      .select(['id', 'form_id'])
      .where('stream_id', '=', '30')
      .executeTakeFirstOrThrow()
    const integration = await db
      .selectFrom('extensions.gcs_gcforms_integrations')
      .select('id')
      .where('stream_id', '=', '30')
      .executeTakeFirstOrThrow()
    const pending = await db
      .insertInto('extensions.gcs_gcforms_submissions')
      .values({
        connection_id: String(connection.id),
        integration_id: String(integration.id),
        form_id: connection.form_id,
        submission_name: 'already-confirmed',
        status: 'imported_pending_confirm',
        confirmation_code: 'confirmation-1'
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    await rotateCredential()
    await expect(deleteGcFormsCredential(createCredentialContext('1'))).rejects.toMatchObject({
      code: 'GCS_GCFORMS_CREDENTIAL_RECOVERABLE_SUBMISSIONS'
    })
    await expect(getGcFormsCredential(db, '20', '1')).resolves.toMatchObject({ formId: 'form-1' })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/oauth/v2/token')) {
        return new Response(JSON.stringify({ access_token: 'token-rotated' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/forms/form-2/template')) {
        return new Response(JSON.stringify(initialTemplate), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/submission/new')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch)
    await refreshTemplate(db, '30')

    const context = createSyncContext()
    const result = await syncStream(context, '30')
    expect(result.pendingConfirmations).toHaveLength(1)
    const reconciliation = result.pendingConfirmations[0]
    if (!reconciliation) {
      throw new Error('Expected a pending confirmation reconciliation.')
    }
    expect(reconciliation).toEqual({
      submissionId: String(pending.id),
      remotelyPending: false
    })
    await reconcileGcFormsSubmissionConfirmation(context, '30', reconciliation)
    await expect(db
      .selectFrom('extensions.gcs_gcforms_submissions')
      .select('status')
      .where('id', '=', String(pending.id))
      .executeTakeFirstOrThrow()).resolves.toEqual({ status: 'imported' })
    await expect(deleteGcFormsCredential(createCredentialContext('1'))).resolves.toEqual({ ok: true })
    await expect(getGcFormsCredential(db, '20', '1')).rejects.toMatchObject({
      code: 'GCS_GCFORMS_CREDENTIAL_MISSING'
    })
  })

  it('keeps a rotated historical pending marker durable when remote confirmation fails, then retries it', async () => {
    let confirmationAttempts = 0
    await db
      .updateTable('extensions.agency_enablement')
      .set({
        config: {
          apiUrl: 'https://api.example.test/v1',
          confirmSubmissions: true,
          submissionStatusId: '91'
        }
      })
      .where('agency_id', '=', '20')
      .execute()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/oauth/v2/token')) {
        return new Response(JSON.stringify({ access_token: 'token-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/template')) {
        return new Response(JSON.stringify(initialTemplate), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/forms/form-1/submission/new')) {
        return new Response(JSON.stringify([
          { name: 'retry-confirmation', createdAt: 1725553403512 }
        ]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/forms/form-2/submission/new')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.includes('/forms/form-1/submission/retry-confirmation/confirm/')) {
        confirmationAttempts += 1
        if (confirmationAttempts === 1) {
          return new Response('{}', { status: 503 })
        }
        return new Response(null, { status: 204 })
      }
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch)
    await refreshTemplate(db, '30')
    const connection = await db
      .selectFrom('extensions.gcs_gcforms_connections')
      .select(['id', 'form_id'])
      .where('stream_id', '=', '30')
      .executeTakeFirstOrThrow()
    const integration = await db
      .selectFrom('extensions.gcs_gcforms_integrations')
      .select('id')
      .where('stream_id', '=', '30')
      .executeTakeFirstOrThrow()
    const pending = await db
      .insertInto('extensions.gcs_gcforms_submissions')
      .values({
        connection_id: String(connection.id),
        integration_id: String(integration.id),
        form_id: connection.form_id,
        submission_name: 'retry-confirmation',
        status: 'imported_pending_confirm',
        confirmation_code: 'confirmation-1'
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    await rotateCredential()
    await refreshTemplate(db, '30')

    const context = createSyncContext()
    const result = await syncStream(context, '30')
    const reconciliation = result.pendingConfirmations.find(item => item.submissionId === String(pending.id))
    if (!reconciliation) {
      throw new Error('Expected the historical pending confirmation.')
    }
    expect(reconciliation.remotelyPending).toBe(true)
    await expect(reconcileGcFormsSubmissionConfirmation(context, '30', reconciliation))
      .rejects.toThrow('status 503')
    await expect(db
      .selectFrom('extensions.gcs_gcforms_submissions')
      .select('status')
      .where('id', '=', String(pending.id))
      .executeTakeFirstOrThrow()).resolves.toEqual({ status: 'imported_pending_confirm' })

    await expect(reconcileGcFormsSubmissionConfirmation(context, '30', reconciliation)).resolves.toBeUndefined()
    expect(confirmationAttempts).toBe(2)
    await expect(db
      .selectFrom('extensions.gcs_gcforms_submissions')
      .select('status')
      .where('id', '=', String(pending.id))
      .executeTakeFirstOrThrow()).resolves.toEqual({ status: 'imported' })
  })

  it('finalizes under the renewed current contract without a remote call when confirmation is disabled', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/oauth/v2/token')) {
        return new Response(JSON.stringify({ access_token: 'token-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (url.endsWith('/forms/form-1/template')) {
        return new Response(JSON.stringify(initialTemplate), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)
    await refreshTemplate(db, '30')
    const connection = await db
      .selectFrom('extensions.gcs_gcforms_connections')
      .select(['id', 'form_id'])
      .where('stream_id', '=', '30')
      .executeTakeFirstOrThrow()
    const integration = await db
      .selectFrom('extensions.gcs_gcforms_integrations')
      .select('id')
      .where('stream_id', '=', '30')
      .executeTakeFirstOrThrow()
    const pending = await db
      .insertInto('extensions.gcs_gcforms_submissions')
      .values({
        connection_id: String(connection.id),
        integration_id: String(integration.id),
        form_id: connection.form_id,
        submission_name: 'do-not-confirm',
        status: 'imported_pending_confirm',
        confirmation_code: 'confirmation-1'
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    await reconcileGcFormsSubmissionConfirmation(createSyncContext(), '30', {
      submissionId: String(pending.id),
      remotelyPending: true
    })
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/confirm/'),
      expect.anything()
    )
    await expect(db
      .selectFrom('extensions.gcs_gcforms_submissions')
      .select('status')
      .where('id', '=', String(pending.id))
      .executeTakeFirstOrThrow()).resolves.toEqual({ status: 'imported' })
  })
})
