import { createHash, createPrivateKey, createSign, privateDecrypt, createDecipheriv } from 'node:crypto'
import { z } from 'zod'
import {
  DEFAULT_GCFORMS_API_URL,
  DEFAULT_GCFORMS_IDP_URL,
  DEFAULT_GCFORMS_PROJECT_IDENTIFIER,
  GcFormsEncryptedSubmissionSchema,
  GcFormsFormTemplateSchema,
  GcFormsNewSubmissionSchema,
  type GcFormsDecryptedSubmission,
  type GcFormsEncryptedSubmission,
  type GcFormsFormTemplate,
  type GcFormsNewSubmission,
  type GcFormsPrivateApiKey
} from '../shared/gcforms.ts'

export interface GcFormsClientOptions {
  apiUrl?: string
  identityProviderUrl?: string
  projectIdentifier?: string
  privateApiKey: GcFormsPrivateApiKey
  fetchImpl?: typeof fetch
  requestTimeoutMs?: number
}

export interface GcFormsProblemReport {
  contactEmail: string
  description: string
  preferredLanguage: 'en' | 'fr'
}

const base64Url = (value: string | Buffer): string =>
  Buffer.from(value).toString('base64url')

const GCM_AUTH_TAG_LENGTH = 16
const DEFAULT_GCFORMS_REQUEST_TIMEOUT_MS = 15_000

const resolveRequestTimeoutMs = (value: number | undefined): number => {
  if (value === undefined) {
    return DEFAULT_GCFORMS_REQUEST_TIMEOUT_MS
  }
  return value
}

/** Signs the short-lived JWT assertion used to authenticate with the GC Forms identity provider. */
export const signGcFormsJwt = async (
  identityProviderUrl: string,
  privateApiKey: GcFormsPrivateApiKey,
  now = Math.floor(Date.now() / 1000)
): Promise<string> => {
  const header = {
    alg: 'RS256',
    kid: privateApiKey.keyId
  }
  const payload = {
    iat: now,
    exp: now + 60,
    iss: privateApiKey.userId,
    sub: privateApiKey.userId,
    aud: identityProviderUrl
  }
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`
  const privateKey = createPrivateKey({ key: privateApiKey.key })
  const signature = createSign('RSA-SHA256').update(signingInput).end().sign(privateKey)

  return `${signingInput}.${base64Url(signature)}`
}

/** Exchanges a signed GC Forms JWT assertion for an OAuth access token. */
export const generateGcFormsAccessToken = async (
  options: Pick<GcFormsClientOptions, 'identityProviderUrl' | 'projectIdentifier' | 'privateApiKey' | 'fetchImpl' | 'requestTimeoutMs'>
): Promise<string> => {
  const identityProviderUrl = options.identityProviderUrl || DEFAULT_GCFORMS_IDP_URL
  const projectIdentifier = options.projectIdentifier || DEFAULT_GCFORMS_PROJECT_IDENTIFIER
  const fetchImpl = options.fetchImpl ?? fetch
  const requestTimeoutMs = resolveRequestTimeoutMs(options.requestTimeoutMs)
  const assertion = await signGcFormsJwt(identityProviderUrl, options.privateApiKey)
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
    scope: `openid profile urn:zitadel:iam:org:project:id:${projectIdentifier}:aud`
  })

  const response = await fetchImpl(`${identityProviderUrl}/oauth/v2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body,
    signal: AbortSignal.timeout(requestTimeoutMs)
  })

  if (!response.ok) {
    throw new Error(`GC Forms token request failed with status ${response.status}`)
  }

  const payload = await response.json() as { access_token?: unknown }
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new Error('GC Forms token response did not include an access token')
  }

  return payload.access_token
}

/** Decrypts a GC Forms submission envelope with its RSA-wrapped AES-GCM parameters. */
export const decryptGcFormsSubmission = (
  encryptedSubmission: GcFormsEncryptedSubmission,
  privateApiKey: GcFormsPrivateApiKey
): string => {
  const privateKey = {
    key: privateApiKey.key,
    oaepHash: 'sha256'
  }

  const decryptedKey = privateDecrypt(privateKey, Buffer.from(encryptedSubmission.encryptedKey, 'base64'))
  const decryptedNonce = privateDecrypt(privateKey, Buffer.from(encryptedSubmission.encryptedNonce, 'base64'))
  const decryptedAuthTag = privateDecrypt(privateKey, Buffer.from(encryptedSubmission.encryptedAuthTag, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', decryptedKey, decryptedNonce, {
    authTagLength: GCM_AUTH_TAG_LENGTH
  })
  decipher.setAuthTag(decryptedAuthTag)

  const encryptedData = Buffer.from(encryptedSubmission.encryptedResponses, 'base64')
  const decryptedData = Buffer.concat([
    decipher.update(encryptedData),
    decipher.final()
  ])

  return decryptedData.toString('utf8')
}

/** Checks decrypted submission answers against the checksum supplied by GC Forms. */
export const verifyGcFormsIntegrity = (answers: string, checksum: string): boolean =>
  createHash('md5').update(answers).digest('hex') === checksum

/** Authenticated client for fetching, decrypting, confirming, and reporting GC Forms submissions. */
export class GcFormsApiClient {
  private readonly apiUrl: string
  private readonly privateApiKey: GcFormsPrivateApiKey
  private readonly fetchImpl: typeof fetch
  private readonly identityProviderUrl: string
  private readonly projectIdentifier: string
  private readonly requestTimeoutMs: number
  private accessToken: string | null = null

  constructor(options: GcFormsClientOptions) {
    this.apiUrl = (options.apiUrl || DEFAULT_GCFORMS_API_URL).replace(/\/$/, '')
    this.identityProviderUrl = options.identityProviderUrl || DEFAULT_GCFORMS_IDP_URL
    this.projectIdentifier = options.projectIdentifier || DEFAULT_GCFORMS_PROJECT_IDENTIFIER
    this.privateApiKey = options.privateApiKey
    this.fetchImpl = options.fetchImpl ?? fetch
    this.requestTimeoutMs = resolveRequestTimeoutMs(options.requestTimeoutMs)
  }

  private async token(): Promise<string> {
    if (!this.accessToken) {
      this.accessToken = await generateGcFormsAccessToken({
        identityProviderUrl: this.identityProviderUrl,
        projectIdentifier: this.projectIdentifier,
        privateApiKey: this.privateApiKey,
        fetchImpl: this.fetchImpl,
        requestTimeoutMs: this.requestTimeoutMs
      })
    }

    return this.accessToken
  }

  /** Sends an authenticated API request, refreshing the cached token once after an unauthorized response. */
  private async request<T>(path: string, init: RequestInit, parse: (value: unknown) => T): Promise<T> {
    const response = await this.fetchImpl(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${await this.token()}`,
        ...init.headers
      },
      signal: AbortSignal.timeout(this.requestTimeoutMs)
    })

    if (response.status === 401) {
      this.accessToken = null
      const retry = await this.fetchImpl(`${this.apiUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${await this.token()}`,
          ...init.headers
        },
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      })
      if (!retry.ok) {
        throw new Error(`GC Forms request failed with status ${retry.status}`)
      }
      return parse(await retry.json())
    }

    if (!response.ok) {
      throw new Error(`GC Forms request failed with status ${response.status}`)
    }

    if (response.status === 204) {
      return parse(null)
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      return parse(null)
    }

    return parse(await response.json())
  }

  async getFormTemplate(): Promise<GcFormsFormTemplate> {
    return await this.request(
      `/forms/${this.privateApiKey.formId}/template`,
      { method: 'GET' },
      value => GcFormsFormTemplateSchema.parse(value)
    )
  }

  async getNewSubmissions(): Promise<GcFormsNewSubmission[]> {
    return await this.request(
      `/forms/${this.privateApiKey.formId}/submission/new`,
      { method: 'GET' },
      value => z.array(GcFormsNewSubmissionSchema).parse(value)
    )
  }

  async getEncryptedSubmission(submissionName: string): Promise<GcFormsEncryptedSubmission> {
    return await this.request(
      `/forms/${this.privateApiKey.formId}/submission/${submissionName}`,
      { method: 'GET' },
      value => GcFormsEncryptedSubmissionSchema.parse(value)
    )
  }

  async getDecryptedSubmission(submissionName: string): Promise<GcFormsDecryptedSubmission> {
    const encrypted = await this.getEncryptedSubmission(submissionName)
    return JSON.parse(decryptGcFormsSubmission(encrypted, this.privateApiKey)) as GcFormsDecryptedSubmission
  }

  async confirmSubmission(submissionName: string, confirmationCode: string): Promise<void> {
    await this.request(
      `/forms/${this.privateApiKey.formId}/submission/${submissionName}/confirm/${confirmationCode}`,
      { method: 'PUT' },
      () => null
    )
  }

  async reportSubmissionProblem(submissionName: string, problem: GcFormsProblemReport): Promise<void> {
    await this.request(
      `/forms/${this.privateApiKey.formId}/submission/${submissionName}/problem`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(problem)
      },
      () => null
    )
  }
}
