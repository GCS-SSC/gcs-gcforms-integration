/* eslint-disable jsdoc/require-jsdoc */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { setEncryptedExtensionSecret } from '@gcs-ssc/extensions/server'
import type { GcFormsIntegrationHostDatabase } from '../../server/db'
import { refreshTemplate, syncStream } from '../../server/runtime'
import { GCFORMS_EXTENSION_KEY } from '../../shared/gcforms'

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
    }
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
        credentialId: 'credential-1',
        formId: 'form-1',
        identityProviderUrl: 'https://idp.example.test',
        projectIdentifier: 'project-1',
        preferredLanguage: 'en',
        mappings: []
      },
      _deleted: false
    })
    .execute()
  await setEncryptedExtensionSecret(db as never, {
    rootKey,
    extensionKey: GCFORMS_EXTENSION_KEY,
    ownerType: 'agency',
    ownerId: '20',
    secretKey: 'credential-1',
    value: {
      keyId: 'key-1',
      key: privateKeyPem(),
      userId: 'user-1',
      formId: 'form-1'
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

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/forms/form-1/submission/new'),
      expect.anything()
    )
    await expect(db
      .selectFrom('extensions.gcs_gcforms_import_runs')
      .select(db.fn.countAll().as('count'))
      .executeTakeFirstOrThrow()).resolves.toMatchObject({ count: 0 })

    await refreshTemplate(db, '30')
    await expect(syncStream(db, '30')).resolves.toMatchObject({
      discovered: 0,
      imported: 0,
      problems: 0
    })
  })
})
