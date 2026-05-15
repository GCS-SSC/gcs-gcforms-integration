/* eslint-disable jsdoc/require-jsdoc */
import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { GcFormsApiClient, generateGcFormsAccessToken, signGcFormsJwt, verifyGcFormsIntegrity } from '../../server/gcforms-client'

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
    const fetchMock = vi.fn(async (url: string) => {
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
      fetchImpl: fetchMock
    })).resolves.toBe('token-1')

    const client = new GcFormsApiClient({
      apiUrl: 'https://api.example.test/v1',
      identityProviderUrl: 'https://idp.example.test',
      projectIdentifier: 'project-1',
      privateApiKey,
      fetchImpl: fetchMock
    })

    await expect(client.getNewSubmissions()).resolves.toEqual([
      { name: '05-09-09f4', createdAt: 1725553403512 }
    ])
  })

  it('verifies checksums over the exact GC Forms answers string', () => {
    expect(verifyGcFormsIntegrity('{"a":"b"}', '92eff9dda44cb8003ee13990782580ff')).toBe(true)
    expect(verifyGcFormsIntegrity('{"a":"b"}', 'bad')).toBe(false)
  })
})
