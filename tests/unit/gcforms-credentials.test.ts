/* eslint-disable jsdoc/require-jsdoc */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { setEncryptedExtensionSecret } from '@gcs-ssc/extensions/server'
import type { GcFormsIntegrationHostDatabase } from '../../server/db'
import {
  deleteGcFormsCredential,
  listGcFormsCredentials
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

const eventFor = (agencyId: string, canAccess = true, credentialId?: string) => ({
  context: {
    $db: db,
    params: {
      agencyId,
      credentialId
    },
    $authContext: {
      userAbilities: {
        authorize: () => canAccess
      }
    }
  }
})

const seedCredential = async (agencyId = '10', credentialId = 'local-claims-gcforms') => {
  const credential = {
    keyId: 'key-1',
    key: privateKeyPem(),
    userId: 'user-1',
    formId: 'form-1'
  }
  await setEncryptedExtensionSecret(db as never, {
    rootKey,
    extensionKey: GCFORMS_EXTENSION_KEY,
    ownerType: 'agency',
    ownerId: agencyId,
    secretKey: credentialId,
    value: credential,
    metadata: {
      credentialId,
      keyId: credential.keyId,
      userId: credential.userId,
      formId: credential.formId
    }
  })

  return credential
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
  it('lists only credential metadata and decrypts private key material for runtime use', async () => {
    const credential = await seedCredential()

    const listed = await listGcFormsCredentials(eventFor('10') as never)

    expect(listed.items).toEqual([
      expect.objectContaining({
        credentialId: 'local-claims-gcforms',
        keyId: 'key-1',
        userId: 'user-1',
        formId: 'form-1'
      })
    ])
    expect(JSON.stringify(listed.items)).not.toContain(credential.key)

    await expect(getGcFormsCredential(db, '10', 'local-claims-gcforms')).resolves.toEqual(credential)
  })

  it('requires agency access and can soft-delete credentials', async () => {
    await seedCredential()

    await expect(listGcFormsCredentials(eventFor('10', false) as never)).rejects.toMatchObject({
      code: 'GCS_GCFORMS_FORBIDDEN'
    })

    await expect(deleteGcFormsCredential(eventFor('10', true, 'local-claims-gcforms') as never)).resolves.toEqual({ ok: true })
    await expect(getGcFormsCredential(db, '10', 'local-claims-gcforms')).rejects.toMatchObject({
      code: 'GCS_GCFORMS_CREDENTIAL_MISSING'
    })
  })

  it('returns an actionable error when the server encryption key is missing', async () => {
    await seedCredential()
    delete process.env.GCS_EXTENSION_SECRETS_KEY

    await expect(getGcFormsCredential(db, '10', 'local-claims-gcforms')).rejects.toMatchObject({
      code: 'GCS_GCFORMS_SECRET_ROOT_KEY_MISSING'
    })
  })
})
