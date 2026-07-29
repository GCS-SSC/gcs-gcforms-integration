import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import { getEncryptedExtensionSecret, setEncryptedExtensionSecret, type GcsExtensionDisableGuardHookPayload } from '@gcs-ssc/extensions/server'
import type { GcFormsIntegrationHostDatabase, GcFormsSubmissionStatus } from '../../server/db'
import { deleteGcFormsCredential, patchGcFormsCredential } from '../../server/credentials'
import { GcFormsApiClient } from '../../server/gcforms-client'
import { resolveClaimMaterializationFailure } from '../../server/materialization-failures'
import { guardGcFormsLifecycleChange } from '../../server/plugins/lifecycle-guards'
import { GCFORMS_EXTENSION_KEY } from '../../shared/gcforms'

const materializeMock = vi.hoisted(() => vi.fn())

vi.mock('../../server/materialize-claims', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/materialize-claims')>(),
  materializeGcFormsClaimSubmission: materializeMock
}))

type TestDb = Kysely<GcFormsIntegrationHostDatabase>

let db: TestDb
let previousRootKey: string | undefined
const rootKey = Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString('base64')

const createSchema = async () => {
  await sql`CREATE SCHEMA extensions`.execute(db)
  await sql`
    CREATE TABLE "Funding_Case_Agreement_Profile" (
      id bigserial PRIMARY KEY,
      egcs_fc_agreementnumber varchar(15) NOT NULL,
      egcs_fc_transferpaymentstream bigint NOT NULL,
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
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE extensions.gcs_gcforms_integrations (
      id bigserial PRIMARY KEY,
      connection_id bigint NOT NULL,
      stream_id bigint NOT NULL,
      config jsonb NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE extensions.gcs_gcforms_submissions (
      id bigserial PRIMARY KEY,
      connection_id bigint NOT NULL,
      integration_id bigint,
      form_id varchar(80) NOT NULL,
      submission_name varchar(80) NOT NULL,
      status varchar(40) NOT NULL,
      confirmation_code varchar(80),
      mapped_values jsonb,
      mapping_issues jsonb,
      last_error text,
      updated_at timestamptz,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE extensions.gcs_gcforms_materialization_overrides (
      id bigserial PRIMARY KEY,
      submission_id bigint NOT NULL,
      destination_entity varchar(60) NOT NULL,
      destination_path varchar(240) NOT NULL,
      owner_type varchar(80) NOT NULL,
      owner_id bigint NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
}

const seedSubmission = async (
  status: GcFormsSubmissionStatus,
  streamId = '30',
  confirmSubmissions = false
) => {
  await db
    .insertInto('extensions.gcs_gcforms_credentials')
    .values({
      id: '1',
      agency_id: '20',
      name_en: 'Claims',
      name_fr: 'Reclamations',
      key_id: 'key-1',
      user_id: 'user-1',
      form_id: 'form-1'
    })
    .execute()
  await setEncryptedExtensionSecret(db, {
    rootKey,
    extensionKey: GCFORMS_EXTENSION_KEY,
    ownerType: 'agency',
    ownerId: '20',
    secretKey: '1',
    value: { key: 'test-private-key' }
  })
  const secret = await db
    .selectFrom('extensions.secret_entry')
    .select(['id', 'created_at', 'updated_at'])
    .executeTakeFirstOrThrow()
  await sql`
    INSERT INTO extensions.gcs_gcforms_connections (
      id,
      agency_id,
      stream_id,
      credential_id,
      credential_revision,
      secret_entry_id,
      secret_updated_at,
      form_id,
      api_url,
      identity_provider_url,
      project_identifier,
      _deleted
    )
    VALUES (
      801,
      20,
      ${streamId}::bigint,
      '1',
      1,
      ${String(secret.id)}::bigint,
      ${secret.updated_at ?? secret.created_at},
      'form-1',
      'https://api.example.test/v1',
      'https://idp.example.test',
      'project-1',
      true
    )
  `.execute(db)
  await sql`
    INSERT INTO extensions.gcs_gcforms_integrations (id, connection_id, stream_id, config)
    VALUES (
      601,
      801,
      ${streamId}::bigint,
      ${JSON.stringify({ confirmSubmissions, mappings: [] })}::jsonb
    )
  `.execute(db)
  await sql`
    INSERT INTO extensions.gcs_gcforms_submissions (
      id,
      connection_id,
      integration_id,
      form_id,
      submission_name,
      status,
      confirmation_code,
      mapped_values,
      mapping_issues
    )
    VALUES (
      901,
      801,
      601,
      'form-1',
      'submission-1',
      ${status},
      'confirmation-1',
      '[]'::jsonb,
      '[]'::jsonb
    )
  `.execute(db)
}

const createContext = () => {
  const lockAuthState = vi.fn(async () => undefined)
  const authorizeCurrentScope = vi.fn(async () => undefined)
  const lockAndAuthorizeAgreement = vi.fn(async () => true)
  return {
    context: {
      db,
      stream: { agencyId: '20' },
      writeAuthorization: {
        lockAuthState,
        authorizeCurrentScope,
        authorizeCurrentEntity: authorizeCurrentScope,
        lockAndAuthorizeAgreement
      }
    } as any,
    lockAuthState,
    authorizeCurrentScope,
    lockAndAuthorizeAgreement
  }
}

const createCredentialContext = (body: unknown) => ({
  ...createContext().context,
  params: { agencyId: '20', credentialId: '1' },
  agency: { agencyId: '20' },
  auth: {
    userId: 'user-1',
    userAbilities: {
      authorize: () => true
    }
  },
  readBody: async () => body
}) as any

const invokeLifecycleGuard = async () => await db.transaction().execute(async trx => {
  await guardGcFormsLifecycleChange({
    extensionKey: GCFORMS_EXTENSION_KEY,
    scope: 'stream',
    event: {},
    db: trx as unknown as GcsExtensionDisableGuardHookPayload['db'],
    agencyId: '20',
    streamId: '30'
  })
})

beforeEach(async () => {
  previousRootKey = process.env.GCS_EXTENSION_SECRETS_KEY
  process.env.GCS_EXTENSION_SECRETS_KEY = rootKey
  const pglite = await KyselyPGlite.create(`memory://gcforms-failure-resolution-${Date.now()}`)
  db = new Kysely<GcFormsIntegrationHostDatabase>({ dialect: pglite.dialect })
  await createSchema()
  materializeMock.mockReset()
})

afterEach(async () => {
  vi.restoreAllMocks()
  if (previousRootKey === undefined) {
    delete process.env.GCS_EXTENSION_SECRETS_KEY
  } else {
    process.env.GCS_EXTENSION_SECRETS_KEY = previousRootKey
  }
  await db.destroy()
})

describe('GC Forms materialization failure resolution', () => {
  it('does not mutate recovery state when fresh agreement update authorization is denied', async () => {
    await seedSubmission('materialization_failed')
    const { context, lockAndAuthorizeAgreement } = createContext()
    const forbidden = Object.assign(new Error('forbidden'), { statusCode: 403 })
    lockAndAuthorizeAgreement.mockRejectedValueOnce(forbidden)

    await expect(resolveClaimMaterializationFailure(context, '30', '901', '101')).rejects.toBe(forbidden)
    expect(lockAndAuthorizeAgreement).toHaveBeenCalledWith(expect.anything(), {
      agreementId: '101',
      streamId: '30',
      action: 'update'
    })
    expect(materializeMock).not.toHaveBeenCalled()
    await expect(db
      .selectFrom('extensions.gcs_gcforms_materialization_overrides')
      .select('id')
      .execute()).resolves.toEqual([])
    await expect(db
      .selectFrom('extensions.gcs_gcforms_submissions')
      .select('status')
      .where('id', '=', '901')
      .executeTakeFirstOrThrow()).resolves.toEqual({ status: 'materialization_failed' })
  })

  it('rejects agreement scope drift before saving an override or materializing a claim', async () => {
    await seedSubmission('materialization_failed')
    const { context, lockAndAuthorizeAgreement } = createContext()
    lockAndAuthorizeAgreement.mockResolvedValueOnce(false)

    await expect(resolveClaimMaterializationFailure(context, '30', '901', '101')).rejects.toMatchObject({
      statusCode: 400,
      code: 'GCS_GCFORMS_AGREEMENT_OVERRIDE_INVALID'
    })
    expect(materializeMock).not.toHaveBeenCalled()
    await expect(db
      .selectFrom('extensions.gcs_gcforms_materialization_overrides')
      .select('id')
      .execute()).resolves.toEqual([])
  })

  it.each(['imported_pending_confirm', 'imported'] as const)(
    'rejects historical %s submissions without changing overrides, materialization, or status',
    async status => {
      await seedSubmission(status)
      const { context, lockAuthState, authorizeCurrentScope } = createContext()

      if (status === 'imported_pending_confirm') {
        await expect(invokeLifecycleGuard()).rejects.toMatchObject({
          code: 'GCS_GCFORMS_SCOPE_RECOVERABLE_SUBMISSIONS'
        })
      }
      await expect(resolveClaimMaterializationFailure(context, '30', '901', '101')).rejects.toMatchObject({
        statusCode: 409,
        code: 'GCS_GCFORMS_SUBMISSION_NOT_MATERIALIZATION_FAILED',
        localizedMessage: {
          en: expect.stringContaining('no longer awaiting'),
          fr: expect.stringContaining('n attend plus')
        }
      })
      expect(lockAuthState).toHaveBeenCalledOnce()
      expect(authorizeCurrentScope).toHaveBeenCalledOnce()
      expect(materializeMock).not.toHaveBeenCalled()
      await expect(db
        .selectFrom('extensions.gcs_gcforms_materialization_overrides')
        .select(db.fn.countAll().as('count'))
        .executeTakeFirstOrThrow()).resolves.toMatchObject({ count: 0 })
      await expect(db
        .selectFrom('extensions.gcs_gcforms_submissions')
        .select('status')
        .where('id', '=', '901')
        .executeTakeFirstOrThrow()).resolves.toEqual({ status })
      if (status === 'imported_pending_confirm') {
        await expect(invokeLifecycleGuard()).rejects.toMatchObject({
          code: 'GCS_GCFORMS_SCOPE_RECOVERABLE_SUBMISSIONS'
        })
      }
    }
  )

  it('returns stable not found for a submission owned by another stream', async () => {
    await seedSubmission('materialization_failed', '31')
    const { context } = createContext()

    await expect(resolveClaimMaterializationFailure(context, '30', '901', '101')).rejects.toMatchObject({
      statusCode: 404,
      code: 'GCS_GCFORMS_SUBMISSION_NOT_FOUND',
      localizedMessage: {
        en: expect.stringContaining('not found'),
        fr: expect.stringContaining('introuvable')
      }
    })
    expect(materializeMock).not.toHaveBeenCalled()
  })

  it('resolves a historical failed submission using its persisted integration context', async () => {
    await seedSubmission('materialization_failed')
    const oldMapping = {
      id: 'agreement-number',
      sourceQuestionId: 'old_agreement_number',
      destinationEntity: 'claim',
      destinationPath: 'egcs_fc_fundingagreement',
      transform: 'string',
      required: true,
      onMissing: 'block',
      onInvalid: 'block'
    }
    const newMapping = { ...oldMapping, sourceQuestionId: 'new_agreement_number' }
    await db
      .updateTable('extensions.gcs_gcforms_integrations')
      .set({ config: { confirmSubmissions: false, mappings: [oldMapping] } })
      .where('id', '=', '601')
      .execute()
    await sql`
      INSERT INTO extensions.gcs_gcforms_integrations (id, connection_id, stream_id, config)
      VALUES (602, 801, 30, ${JSON.stringify({ confirmSubmissions: false, mappings: [newMapping] })}::jsonb)
    `.execute(db)
    await db
      .insertInto('Funding_Case_Agreement_Profile')
      .values({
        id: '101',
        egcs_fc_agreementnumber: 'AGR-001',
        egcs_fc_transferpaymentstream: '30'
      })
      .execute()
    materializeMock.mockResolvedValue({
      status: 'created',
      claimId: '501',
      lineItemIds: [],
      issues: []
    })
    const confirmSpy = vi.spyOn(GcFormsApiClient.prototype, 'confirmSubmission').mockResolvedValue()
    const { context } = createContext()

    await expect(resolveClaimMaterializationFailure(context, '30', '901', '101')).resolves.toMatchObject({
      ok: true,
      status: 'imported'
    })
    expect(materializeMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      streamId: '30',
      integrationId: '601',
      submissionId: '901',
      submissionUuid: 'submission-1',
      mappings: [expect.objectContaining({ sourceQuestionId: 'old_agreement_number' })]
    }))
    expect(confirmSpy).not.toHaveBeenCalled()
    await expect(db
      .selectFrom('extensions.gcs_gcforms_materialization_overrides')
      .select(['submission_id', 'owner_id'])
      .executeTakeFirstOrThrow()).resolves.toMatchObject({
      submission_id: 901,
      owner_id: 101
    })
    await expect(db
      .selectFrom('extensions.gcs_gcforms_submissions')
      .select('status')
      .where('id', '=', '901')
      .executeTakeFirstOrThrow()).resolves.toEqual({ status: 'imported' })
  })

  it('durably confirms a created manual recovery when its historical policy enables confirmation', async () => {
    await seedSubmission('materialization_failed', '30', true)
    await db
      .insertInto('Funding_Case_Agreement_Profile')
      .values({
        id: '101',
        egcs_fc_agreementnumber: 'AGR-001',
        egcs_fc_transferpaymentstream: '30'
      })
      .execute()
    materializeMock.mockResolvedValue({
      status: 'created',
      claimId: '501',
      lineItemIds: [],
      issues: []
    })
    const confirmSpy = vi.spyOn(GcFormsApiClient.prototype, 'confirmSubmission').mockResolvedValue()
    const { context, lockAuthState, authorizeCurrentScope } = createContext()

    await expect(resolveClaimMaterializationFailure(context, '30', '901', '101')).resolves.toMatchObject({
      ok: true,
      status: 'imported'
    })
    expect(confirmSpy).toHaveBeenCalledWith('submission-1', 'confirmation-1')
    expect(lockAuthState).toHaveBeenCalledTimes(3)
    expect(authorizeCurrentScope).toHaveBeenCalledTimes(3)
    expect(authorizeCurrentScope.mock.invocationCallOrder[1])
      .toBeLessThan(confirmSpy.mock.invocationCallOrder[0] as number)
    expect(confirmSpy.mock.invocationCallOrder[0])
      .toBeLessThan(lockAuthState.mock.invocationCallOrder[2] as number)
    await expect(db
      .selectFrom('extensions.gcs_gcforms_submissions')
      .select('status')
      .where('id', '=', '901')
      .executeTakeFirstOrThrow()).resolves.toEqual({ status: 'imported' })
  })

  it('preserves authentication through failed recovery, then permits rotation and deletion after recovery', async () => {
    await seedSubmission('materialization_failed')
    await db
      .insertInto('Funding_Case_Agreement_Profile')
      .values({ id: '101', egcs_fc_agreementnumber: 'AGR-001', egcs_fc_transferpaymentstream: '30' })
      .execute()
    const secretBefore = await db
      .selectFrom('extensions.secret_entry')
      .select(['ciphertext', 'updated_at', '_deleted'])
      .where('secret_key', '=', '1')
      .executeTakeFirstOrThrow()

    await expect(patchGcFormsCredential(createCredentialContext({ keyId: 'blocked-key' }))).rejects.toMatchObject({
      statusCode: 409,
      code: 'GCS_GCFORMS_CREDENTIAL_UPDATE_RECOVERABLE_SUBMISSIONS'
    })
    await expect(deleteGcFormsCredential(createCredentialContext({}))).rejects.toMatchObject({
      statusCode: 409,
      code: 'GCS_GCFORMS_CREDENTIAL_RECOVERABLE_SUBMISSIONS'
    })
    await expect(patchGcFormsCredential(createCredentialContext({
      name_en: 'Safe label',
      keyId: 'key-1',
      userId: 'user-1',
      formId: 'form-1'
    }))).resolves.toMatchObject({
      item: { name_en: 'Safe label', keyId: 'key-1' }
    })
    await expect(db
      .selectFrom('extensions.gcs_gcforms_credentials')
      .select('revision')
      .where('id', '=', '1')
      .executeTakeFirstOrThrow()).resolves.toEqual({ revision: 1 })
    await expect(db
      .selectFrom('extensions.secret_entry')
      .select(['ciphertext', 'updated_at', '_deleted'])
      .where('secret_key', '=', '1')
      .executeTakeFirstOrThrow()).resolves.toEqual(secretBefore)

    materializeMock.mockResolvedValue({ status: 'created', claimId: '501', lineItemIds: [], issues: [] })
    await resolveClaimMaterializationFailure(createContext().context, '30', '901', '101')
    await expect(patchGcFormsCredential(createCredentialContext({ keyId: 'rotated-key' }))).resolves.toMatchObject({
      item: { keyId: 'rotated-key' }
    })
    await expect(deleteGcFormsCredential(createCredentialContext({}))).resolves.toEqual({ ok: true })
    await expect(getEncryptedExtensionSecret(db, {
      rootKey,
      extensionKey: GCFORMS_EXTENSION_KEY,
      ownerType: 'agency',
      ownerId: '20',
      secretKey: '1'
    })).resolves.toBeNull()
  })
})
