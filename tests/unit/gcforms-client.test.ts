import {
  createCipheriv,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes
} from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  decryptGcFormsSubmission,
  GcFormsApiClient,
  GCFORMS_NEW_SUBMISSIONS_RESPONSE_MAX_BYTES,
  GCFORMS_NEW_SUBMISSIONS_RESPONSE_MAX_COUNT,
  generateGcFormsAccessToken,
  signGcFormsJwt,
  verifyGcFormsIntegrity
} from '../../server/gcforms-client'
import type { GcFormsEncryptedSubmission, GcFormsPrivateApiKey } from '../../shared/gcforms'

const generateRsaKeys = () => generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  },
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  }
})

const privateKeyPem = () => generateRsaKeys().privateKey

const createEncryptedSubmission = (
  answers: string,
  authTagLength = 16
): {
  encryptedSubmission: GcFormsEncryptedSubmission
  privateApiKey: GcFormsPrivateApiKey
} => {
  const { privateKey, publicKey } = generateRsaKeys()
  const encryptionKey = randomBytes(32)
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce, { authTagLength: 16 })
  const encryptedResponses = Buffer.concat([
    cipher.update(answers, 'utf8'),
    cipher.final()
  ])
  const wrap = (value: Buffer) => publicEncrypt(
    { key: publicKey, oaepHash: 'sha256' },
    value
  ).toString('base64')

  return {
    encryptedSubmission: {
      encryptedKey: wrap(encryptionKey),
      encryptedNonce: wrap(nonce),
      encryptedAuthTag: wrap(cipher.getAuthTag().subarray(0, authTagLength)),
      encryptedResponses: encryptedResponses.toString('base64')
    },
    privateApiKey: {
      keyId: 'key-1',
      key: privateKey,
      userId: 'user-1',
      formId: 'c123456789012345678901234'
    }
  }
}

describe('GC Forms API client', () => {
  it('signs JWT bearer assertions with the expected claims', async () => {
    const token = await signGcFormsJwt('https://idp.example.test', {
      keyId: 'key-1',
      key: privateKeyPem(),
      userId: 'user-1',
      formId: 'form-1'
    }, 1000)
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')

    expect(JSON.parse(Buffer.from(encodedHeader!, 'base64url').toString('utf8'))).toEqual({
      alg: 'RS256',
      kid: 'key-1'
    })
    expect(JSON.parse(Buffer.from(encodedPayload!, 'base64url').toString('utf8'))).toEqual({
      iat: 1000,
      exp: 1060,
      iss: 'user-1',
      sub: 'user-1',
      aud: 'https://idp.example.test'
    })
    expect(encodedSignature?.length).toBeGreaterThan(100)
  })

  it('generates access tokens and retrieves typed API responses', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      if (url.endsWith('/oauth/v2/token')) {
        return new Response(JSON.stringify({ access_token: 'token-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }

      return new Response(JSON.stringify([
        { name: '05-09-09f4', createdAt: 1725553403512 }
      ]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }) as unknown as typeof fetch

    const privateApiKey = {
      keyId: 'key-1',
      key: privateKeyPem(),
      userId: 'user-1',
      formId: 'c123456789012345678901234'
    }

    await expect(generateGcFormsAccessToken({
      identityProviderUrl: 'https://idp.example.test',
      projectIdentifier: 'project-1',
      privateApiKey,
      fetchImpl: fetchMock,
      requestTimeoutMs: 1234
    })).resolves.toBe('token-1')

    const client = new GcFormsApiClient({
      apiUrl: 'https://api.example.test/v1',
      identityProviderUrl: 'https://idp.example.test',
      projectIdentifier: 'project-1',
      privateApiKey,
      fetchImpl: fetchMock,
      requestTimeoutMs: 1234
    })

    await expect(client.getNewSubmissions()).resolves.toEqual([
      { name: '05-09-09f4', createdAt: 1725553403512 }
    ])
  })

  it('retains the single authentication retry after an unauthorized API response', async () => {
    let tokenRequests = 0
    const authorizationHeaders: string[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/oauth/v2/token')) {
        tokenRequests += 1
        return new Response(JSON.stringify({ access_token: `token-${tokenRequests}` }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      authorizationHeaders.push(String((init?.headers as Record<string, string>).authorization))
      if (authorizationHeaders.length === 1) {
        return new Response('{}', { status: 401 })
      }
      return new Response(JSON.stringify([
        { name: 'retried-submission', createdAt: 1 }
      ]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }) as unknown as typeof fetch
    const client = new GcFormsApiClient({
      apiUrl: 'https://api.example.test/v1',
      identityProviderUrl: 'https://idp.example.test',
      privateApiKey: {
        keyId: 'key-1',
        key: privateKeyPem(),
        userId: 'user-1',
        formId: 'form-1'
      },
      fetchImpl: fetchMock
    })

    await expect(client.getNewSubmissions()).resolves.toEqual([
      { name: 'retried-submission', createdAt: 1 }
    ])
    expect(tokenRequests).toBe(2)
    expect(authorizationHeaders).toEqual(['Bearer token-1', 'Bearer token-2'])
  })

  it('rejects new-submission metadata over the stable response count before detail retrieval', async () => {
    const requestedUrls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      requestedUrls.push(url)
      if (url.endsWith('/oauth/v2/token')) {
        return new Response(JSON.stringify({ access_token: 'token-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response(JSON.stringify(Array.from(
        { length: GCFORMS_NEW_SUBMISSIONS_RESPONSE_MAX_COUNT + 1 },
        (_, index) => ({ name: `submission-${index}`, createdAt: index })
      )), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }) as unknown as typeof fetch
    const client = new GcFormsApiClient({
      apiUrl: 'https://api.example.test/v1',
      identityProviderUrl: 'https://idp.example.test',
      privateApiKey: {
        keyId: 'key-1',
        key: privateKeyPem(),
        userId: 'user-1',
        formId: 'form-1'
      },
      fetchImpl: fetchMock
    })

    await expect(client.getNewSubmissions()).rejects.toThrow()
    expect(requestedUrls.filter(url => url.includes('/submission/'))).toEqual([
      'https://api.example.test/v1/forms/form-1/submission/new'
    ])
  })

  it.each(['declared', 'streamed'] as const)(
    'rejects %s new-submission responses over the byte limit',
    async kind => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.endsWith('/oauth/v2/token')) {
          return new Response(JSON.stringify({ access_token: 'token-1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        }
        return kind === 'declared'
          ? new Response('[]', {
              status: 200,
              headers: {
                'content-type': 'application/json',
                'content-length': String(GCFORMS_NEW_SUBMISSIONS_RESPONSE_MAX_BYTES + 1)
              }
            })
          : new Response('x'.repeat(GCFORMS_NEW_SUBMISSIONS_RESPONSE_MAX_BYTES + 1), {
              status: 200,
              headers: { 'content-type': 'application/json' }
            })
      }) as unknown as typeof fetch
      const client = new GcFormsApiClient({
        apiUrl: 'https://api.example.test/v1',
        identityProviderUrl: 'https://idp.example.test',
        privateApiKey: {
          keyId: 'key-1',
          key: privateKeyPem(),
          userId: 'user-1',
          formId: 'form-1'
        },
        fetchImpl: fetchMock
      })

      await expect(client.getNewSubmissions()).rejects.toMatchObject({
        code: 'GCS_GCFORMS_RESPONSE_TOO_LARGE'
      })
    }
  )

  it('rejects unsafe API and identity-provider endpoints before sending credentials', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch
    const privateApiKey = {
      keyId: 'key-1',
      key: privateKeyPem(),
      userId: 'user-1',
      formId: 'form-1'
    }

    await expect(generateGcFormsAccessToken({
      identityProviderUrl: 'http://169.254.169.254',
      privateApiKey,
      fetchImpl: fetchMock
    })).rejects.toThrow()
    expect(() => new GcFormsApiClient({
      apiUrl: 'https://127.0.0.1/v1',
      identityProviderUrl: 'https://idp.example.test',
      privateApiKey,
      fetchImpl: fetchMock
    })).toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('verifies checksums over the exact GC Forms answers string', () => {
    expect(verifyGcFormsIntegrity('{"a":"b"}', '92eff9dda44cb8003ee13990782580ff')).toBe(true)
    expect(verifyGcFormsIntegrity('{"a":"b"}', 'bad')).toBe(false)
  })

  it('requires a full-length authentication tag when decrypting submissions', () => {
    const answers = '{"answer":"value"}'
    const valid = createEncryptedSubmission(answers)
    const truncated = createEncryptedSubmission(answers, 12)

    expect(decryptGcFormsSubmission(
      valid.encryptedSubmission,
      valid.privateApiKey
    )).toBe(answers)
    expect(() => decryptGcFormsSubmission(
      truncated.encryptedSubmission,
      truncated.privateApiKey
    )).toThrow()
  })

  it('validates decrypted submission payloads before returning them to persistence', async () => {
    const encrypted = createEncryptedSubmission('{"createdAt":"not-a-date"}')
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/oauth/v2/token')) {
        return new Response(JSON.stringify({ access_token: 'token-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response(JSON.stringify(encrypted.encryptedSubmission), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }) as unknown as typeof fetch
    const client = new GcFormsApiClient({
      apiUrl: 'https://api.example.test/v1',
      identityProviderUrl: 'https://idp.example.test',
      privateApiKey: encrypted.privateApiKey,
      fetchImpl: fetchMock
    })

    await expect(client.getDecryptedSubmission('submission-1')).rejects.toThrow()
  })

  it('encodes credential and remote identifiers as single URL path segments', async () => {
    const requestedUrls: string[] = []
    const encrypted = createEncryptedSubmission('{}')
    const fetchMock = vi.fn(async (url: string) => {
      requestedUrls.push(url)
      if (url.endsWith('/oauth/v2/token')) {
        return new Response(JSON.stringify({ access_token: 'token-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response(JSON.stringify(encrypted.encryptedSubmission), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }) as unknown as typeof fetch
    const client = new GcFormsApiClient({
      apiUrl: 'https://api.example.test/v1',
      identityProviderUrl: 'https://idp.example.test',
      privateApiKey: { ...encrypted.privateApiKey, formId: 'form/../admin' },
      fetchImpl: fetchMock
    })

    await client.getEncryptedSubmission('submission/confirm/other')

    expect(requestedUrls.at(-1)).toBe(
      'https://api.example.test/v1/forms/form%2F..%2Fadmin/submission/submission%2Fconfirm%2Fother'
    )
  })
})
