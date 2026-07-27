import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { getEncryptedExtensionSecret, setEncryptedExtensionSecret } from '@gcs-ssc/extensions/server'
import type { GcsExtensionAuthContext, GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import { executeGcFormsTransaction, type GcFormsIntegrationHostDatabase } from '../../server/db'
import {
  createGcFormsCredential,
  deleteGcFormsCredential,
  listGcFormsCredentials,
  patchGcFormsCredential
} from '../../server/credentials'
import { getGcFormsCredential } from '../../server/runtime'
import { GCFORMS_EXTENSION_KEY } from '../../shared/gcforms'

const writePhaseOrder = vi.hoisted((): string[] => [])
const lockLifecycleMock = vi.hoisted(() => vi.fn(async () => {
  writePhaseOrder.push('lifecycle')
}))

vi.mock('@gcs-ssc/extensions/server', async importOriginal => ({
  ...await importOriginal<typeof import('@gcs-ssc/extensions/server')>(),
  lockGcsExtensionLifecycleScope: lockLifecycleMock
}))

type TestDb = Kysely<GcFormsIntegrationHostDatabase>

const rootKey = Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64')
let db: TestDb
let previousRootKey: string | undefined

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

const createSchema = async () => {
  await sql`CREATE SCHEMA extensions`.execute(db)
  await sql`
    CREATE TABLE "Agency_Profile" (
      id bigserial PRIMARY KEY,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`INSERT INTO "Agency_Profile" (id) VALUES (10), (20)`.execute(db)
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
    CREATE TABLE extensions.gcs_gcforms_submissions (
      id bigserial PRIMARY KEY,
      connection_id bigint NOT NULL,
      integration_id bigint,
      form_id varchar(200) NOT NULL,
      submission_name varchar(200) NOT NULL,
      status varchar(40) NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
}

const auth = (canAccess = true): GcsExtensionAuthContext => ({
  userId: 'user-1',
  userAbilities: {
    authorize: () => canAccess,
    authorizeWithTeam: () => canAccess
  }
})

const contextFor = (
  agencyId: string,
  canAccess = true,
  credentialId?: string,
  body?: unknown
): GcsExtensionRouteContext => {
  const params = {
    agencyId,
    credentialId
  }
  const authContext = auth(canAccess)
  const event = {
    context: {
      $db: db,
      params,
      $authContext: authContext
    }
  }

  return {
    event,
    db,
    params,
    auth: authContext,
    config: {},
    agency: { agencyId },
    writeAuthorization: {
      lockAuthState: async () => {
        writePhaseOrder.push('auth-state')
      },
      authorizeCurrentEntity: async () => {
        writePhaseOrder.push('authorize-current')
      }
    },
    readBody: async <T = unknown>() => body as T,
    getHeader: () => undefined
  }
}

const seedCredential = async (agencyId = '10', name = 'Local claims') => {
  const row = await db
    .insertInto('extensions.gcs_gcforms_credentials')
    .values({
      agency_id: agencyId,
      name_en: name,
      name_fr: `${name} FR`,
      key_id: `${name}-key`,
      user_id: `${name}-user`,
      form_id: `${name}-form`
    })
    .returningAll()
    .executeTakeFirstOrThrow()
  const key = privateKeyPem()
  await setEncryptedExtensionSecret(db, {
    rootKey,
    extensionKey: GCFORMS_EXTENSION_KEY,
    ownerType: 'agency',
    ownerId: agencyId,
    secretKey: String(row.id),
    value: { key },
    metadata: { credentialId: String(row.id) }
  })

  return {
    id: String(row.id),
    key,
    keyId: row.key_id,
    userId: row.user_id,
    formId: row.form_id
  }
}

beforeEach(async () => {
  writePhaseOrder.length = 0
  previousRootKey = process.env.GCS_EXTENSION_SECRETS_KEY
  process.env.GCS_EXTENSION_SECRETS_KEY = rootKey
  const pglite = await KyselyPGlite.create(`memory://gcforms-credentials-${Date.now()}`)
  db = new Kysely<GcFormsIntegrationHostDatabase>({ dialect: pglite.dialect })
  await createSchema()
})

afterEach(async () => {
  if (previousRootKey === undefined) {
    delete process.env.GCS_EXTENSION_SECRETS_KEY
  } else {
    process.env.GCS_EXTENSION_SECRETS_KEY = previousRootKey
  }
  await db.destroy()
})

describe('GC Forms encrypted credentials', () => {
  it('reuses an owning Kysely transaction instead of attempting a nested transaction', async () => {
    await db.transaction().execute(async trx => {
      await expect(executeGcFormsTransaction(trx, async current => current)).resolves.toBe(trx)
    })
  })

  it('lists multiple credential rows and never exposes private key material', async () => {
    const first = await seedCredential('10', 'Local claims')
    const second = await seedCredential('10', 'Rotated claims')

    const listed = await listGcFormsCredentials(contextFor('10'))

    expect(listed.items).toEqual([
      expect.objectContaining({
        id: first.id,
        name_en: 'Local claims',
        keyId: 'Local claims-key',
        userId: 'Local claims-user',
        formId: 'Local claims-form'
      }),
      expect.objectContaining({
        id: second.id,
        name_en: 'Rotated claims',
        keyId: 'Rotated claims-key',
        userId: 'Rotated claims-user',
        formId: 'Rotated claims-form'
      })
    ])
    expect(JSON.stringify(listed.items)).not.toContain(first.key)
    expect(JSON.stringify(listed.items)).not.toContain(second.key)

    await expect(getGcFormsCredential(db, '10', first.id)).resolves.toEqual({
      keyId: first.keyId,
      key: first.key,
      userId: first.userId,
      formId: first.formId
    })
  })

  it('requires agency read/update authorization', async () => {
    await seedCredential()

    await expect(listGcFormsCredentials(contextFor('10', false))).rejects.toMatchObject({
      code: 'GCS_GCFORMS_FORBIDDEN'
    })
    await expect(createGcFormsCredential(contextFor('10', false, undefined, {}))).rejects.toMatchObject({
      code: 'GCS_GCFORMS_FORBIDDEN'
    })
  })

  it('creates credentials with required bilingual names', async () => {
    const key = privateKeyPem()
    await expect(createGcFormsCredential(contextFor('10', true, undefined, {
      name_en: 'Claims',
      name_fr: 'Reclamations',
      keyId: 'key-1',
      userId: 'user-1',
      formId: 'form-1',
      key
    }))).resolves.toMatchObject({
      ok: true,
      item: {
        id: expect.any(String),
        name_en: 'Claims',
        name_fr: 'Reclamations',
        keyId: 'key-1',
        userId: 'user-1',
        formId: 'form-1'
      }
    })
    expect(writePhaseOrder).toEqual(['auth-state', 'lifecycle', 'authorize-current'])

    const row = await db
      .selectFrom('extensions.gcs_gcforms_credentials')
      .selectAll()
      .executeTakeFirstOrThrow()
    await expect(getGcFormsCredential(db, '10', String(row.id))).resolves.toMatchObject({
      key
    })
  })

  it('patches metadata without requiring a new key', async () => {
    const credential = await seedCredential()

    await expect(patchGcFormsCredential(contextFor('10', true, credential.id, {
      name_en: 'Updated claims'
    }))).resolves.toMatchObject({
      item: {
        id: credential.id,
        name_en: 'Updated claims',
        formId: credential.formId
      }
    })

    await expect(getGcFormsCredential(db, '10', credential.id)).resolves.toEqual({
      keyId: credential.keyId,
      key: credential.key,
      userId: credential.userId,
      formId: credential.formId
    })
    await expect(db
      .selectFrom('extensions.gcs_gcforms_credentials')
      .select('revision')
      .where('id', '=', credential.id)
      .executeTakeFirstOrThrow()).resolves.toEqual({ revision: 1 })
  })

  it('replaces encrypted key when patch includes key', async () => {
    const credential = await seedCredential()
    const nextKey = privateKeyPem()

    await patchGcFormsCredential(contextFor('10', true, credential.id, { key: nextKey }))

    await expect(getEncryptedExtensionSecret(db, {
      rootKey,
      extensionKey: GCFORMS_EXTENSION_KEY,
      ownerType: 'agency',
      ownerId: '10',
      secretKey: credential.id
    })).resolves.toEqual({ key: nextKey })
    await expect(db
      .selectFrom('extensions.gcs_gcforms_credentials')
      .select('revision')
      .where('id', '=', credential.id)
      .executeTakeFirstOrThrow()).resolves.toEqual({ revision: 2 })
  })

  it('soft-deletes credential row and encrypted secret', async () => {
    const credential = await seedCredential()

    await expect(deleteGcFormsCredential(contextFor('10', true, credential.id))).resolves.toEqual({ ok: true })
    await expect(getGcFormsCredential(db, '10', credential.id)).rejects.toMatchObject({
      code: 'GCS_GCFORMS_CREDENTIAL_MISSING'
    })
    await expect(db
      .selectFrom('extensions.gcs_gcforms_credentials')
      .select('_deleted')
      .where('id', '=', credential.id)
      .executeTakeFirstOrThrow()).resolves.toMatchObject({ _deleted: true })
    await expect(db
      .selectFrom('extensions.secret_entry')
      .select('_deleted')
      .where('secret_key', '=', credential.id)
      .executeTakeFirstOrThrow()).resolves.toMatchObject({ _deleted: true })
  })

  it('preserves a credential and its secret while a historical connection has pending confirmations', async () => {
    const credential = await seedCredential()
    const secretBefore = await db
      .selectFrom('extensions.secret_entry')
      .select(['ciphertext', 'updated_at'])
      .where('secret_key', '=', credential.id)
      .executeTakeFirstOrThrow()
    const connection = await db
      .insertInto('extensions.gcs_gcforms_connections')
      .values({
        agency_id: '10',
        stream_id: '30',
        credential_id: credential.id,
        credential_revision: 1,
        secret_entry_id: '1',
        secret_updated_at: new Date(0),
        form_id: credential.formId,
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
        form_id: credential.formId,
        submission_name: 'pending-1',
        status: 'imported_pending_confirm'
      })
      .execute()
    await db
      .updateTable('extensions.gcs_gcforms_connections')
      .set({ _deleted: true })
      .where('id', '=', connection.id)
      .execute()

    await expect(patchGcFormsCredential(contextFor('10', true, credential.id, {
      name_en: 'Renamed claims',
      keyId: credential.keyId,
      userId: credential.userId,
      formId: credential.formId,
      key: credential.key
    }))).resolves.toMatchObject({
      item: { name_en: 'Renamed claims' }
    })
    await expect(db
      .selectFrom('extensions.secret_entry')
      .select(['_deleted', 'ciphertext', 'updated_at'])
      .where('secret_key', '=', credential.id)
      .executeTakeFirstOrThrow()).resolves.toEqual({ _deleted: false, ...secretBefore })

    await expect(patchGcFormsCredential(contextFor('10', true, credential.id, {
      keyId: 'replacement-key-id',
      userId: 'replacement-user-id',
      formId: 'replacement-form-id',
      key: privateKeyPem()
    }))).rejects.toMatchObject({
      statusCode: 409,
      code: 'GCS_GCFORMS_CREDENTIAL_UPDATE_RECOVERABLE_SUBMISSIONS',
      localizedMessage: {
        en: expect.stringContaining('cannot be changed'),
        fr: expect.stringContaining('ne peut pas etre modifiee')
      }
    })
    await expect(deleteGcFormsCredential(contextFor('10', true, credential.id))).rejects.toMatchObject({
      statusCode: 409,
      code: 'GCS_GCFORMS_CREDENTIAL_RECOVERABLE_SUBMISSIONS',
      localizedMessage: {
        en: expect.stringContaining('cannot be deleted'),
        fr: expect.stringContaining('ne peut pas etre supprime')
      }
    })
    await expect(getGcFormsCredential(db, '10', credential.id)).resolves.toEqual({
      key: credential.key,
      keyId: credential.keyId,
      userId: credential.userId,
      formId: credential.formId
    })
    await expect(db
      .selectFrom('extensions.gcs_gcforms_credentials')
      .select(['_deleted', 'revision'])
      .where('id', '=', credential.id)
      .executeTakeFirstOrThrow()).resolves.toEqual({ _deleted: false, revision: 1 })
    await expect(db
      .selectFrom('extensions.secret_entry')
      .select(['_deleted', 'ciphertext', 'updated_at'])
      .where('secret_key', '=', credential.id)
      .executeTakeFirstOrThrow()).resolves.toEqual({ _deleted: false, ...secretBefore })
  })

  it('returns an actionable error when the server encryption key is missing', async () => {
    const credential = await seedCredential()
    delete process.env.GCS_EXTENSION_SECRETS_KEY

    await expect(getGcFormsCredential(db, '10', credential.id)).rejects.toMatchObject({
      code: 'GCS_GCFORMS_SECRET_ROOT_KEY_MISSING'
    })
  })
})
