import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { getEncryptedExtensionSecret, setEncryptedExtensionSecret } from '@gcs-ssc/extensions/server'
import type { GcFormsIntegrationHostDatabase } from '../../server/db'
import {
  createGcFormsCredential,
  deleteGcFormsCredential,
  listGcFormsCredentials,
  patchGcFormsCredential
} from '../../server/credentials'
import { getGcFormsCredential } from '../../server/runtime'
import { GCFORMS_EXTENSION_KEY } from '../../shared/gcforms'

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
}

const auth = (canAccess = true) => ({
  userAbilities: {
    authorize: () => canAccess
  }
})

const contextFor = (agencyId: string, canAccess = true, credentialId?: string, body?: unknown) => ({
  db,
  params: {
    agencyId,
    credentialId
  },
  auth: auth(canAccess),
  config: {},
  readBody: async () => body,
  getHeader: () => undefined
})

const eventFor = (agencyId: string, canAccess = true, credentialId?: string) => ({
  context: {
    $db: db,
    params: {
      agencyId,
      credentialId
    },
    $authContext: auth(canAccess)
  }
})

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
  await setEncryptedExtensionSecret(db as never, {
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
  it('lists multiple credential rows and never exposes private key material', async () => {
    const first = await seedCredential('10', 'Local claims')
    const second = await seedCredential('10', 'Rotated claims')

    const listed = await listGcFormsCredentials(eventFor('10') as never)

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

    await expect(listGcFormsCredentials(eventFor('10', false) as never)).rejects.toMatchObject({
      code: 'GCS_GCFORMS_FORBIDDEN'
    })
    await expect(createGcFormsCredential(contextFor('10', false, undefined, {}) as never)).rejects.toMatchObject({
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
    }) as never)).resolves.toMatchObject({
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
      name_en: 'Updated claims',
      formId: 'form-2'
    }) as never)).resolves.toMatchObject({
      item: {
        id: credential.id,
        name_en: 'Updated claims',
        formId: 'form-2'
      }
    })

    await expect(getGcFormsCredential(db, '10', credential.id)).resolves.toEqual({
      keyId: credential.keyId,
      key: credential.key,
      userId: credential.userId,
      formId: 'form-2'
    })
  })

  it('replaces encrypted key when patch includes key', async () => {
    const credential = await seedCredential()
    const nextKey = privateKeyPem()

    await patchGcFormsCredential(contextFor('10', true, credential.id, { key: nextKey }) as never)

    await expect(getEncryptedExtensionSecret(db as never, {
      rootKey,
      extensionKey: GCFORMS_EXTENSION_KEY,
      ownerType: 'agency',
      ownerId: '10',
      secretKey: credential.id
    })).resolves.toEqual({ key: nextKey })
  })

  it('soft-deletes credential row and encrypted secret', async () => {
    const credential = await seedCredential()

    await expect(deleteGcFormsCredential(eventFor('10', true, credential.id) as never)).resolves.toEqual({ ok: true })
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

  it('returns an actionable error when the server encryption key is missing', async () => {
    const credential = await seedCredential()
    delete process.env.GCS_EXTENSION_SECRETS_KEY

    await expect(getGcFormsCredential(db, '10', credential.id)).rejects.toMatchObject({
      code: 'GCS_GCFORMS_SECRET_ROOT_KEY_MISSING'
    })
  })
})
