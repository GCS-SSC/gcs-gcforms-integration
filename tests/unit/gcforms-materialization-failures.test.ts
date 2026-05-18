/* eslint-disable jsdoc/require-jsdoc */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import type { GcFormsIntegrationHostDatabase } from '../../server/db'
import { listClaimMaterializationFailures } from '../../server/materialization-failures'

vi.mock('../../server/runtime', () => ({
  ensureConnection: vi.fn(async () => ({ id: '801' })),
  ensureIntegration: vi.fn(async () => ({ id: '601' })),
  getStreamConfig: vi.fn(async () => ({
    credentialId: 'credential',
    formId: 'form-1',
    preferredLanguage: 'en',
    mappings: []
  }))
}))

type TestDb = Kysely<GcFormsIntegrationHostDatabase>

let db: TestDb

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
    CREATE TABLE extensions.gcs_gcforms_submissions (
      id bigserial PRIMARY KEY,
      connection_id bigint NOT NULL,
      integration_id bigint,
      form_id varchar(80) NOT NULL,
      submission_name varchar(80) NOT NULL,
      gcforms_created_at timestamptz,
      status varchar(40) NOT NULL,
      confirmation_code varchar(80),
      answers jsonb,
      answers_checksum varchar(80),
      mapped_values jsonb,
      mapping_issues jsonb,
      last_error text,
      confirmed_at timestamptz,
      created_at timestamptz DEFAULT now() NOT NULL,
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

beforeEach(async () => {
  const pglite = await KyselyPGlite.create(`memory://gcforms-materialization-failures-${Date.now()}`)
  db = new Kysely<GcFormsIntegrationHostDatabase>({ dialect: pglite.dialect })
  await createSchema()
})

afterEach(async () => {
  await db.destroy()
})

describe('GC Forms materialization failure queue', () => {
  it('lists unresolved failures with stream agreement options and selected overrides', async () => {
    await db
      .insertInto('Funding_Case_Agreement_Profile')
      .values([
        {
          id: '101',
          egcs_fc_agreementnumber: 'AGR-001',
          egcs_fc_transferpaymentstream: '31'
        },
        {
          id: '102',
          egcs_fc_agreementnumber: 'AGR-002',
          egcs_fc_transferpaymentstream: '32'
        }
      ])
      .execute()
    await db
      .insertInto('extensions.gcs_gcforms_submissions')
      .values([
        {
          id: '901',
          connection_id: '801',
          integration_id: '601',
          form_id: 'form-1',
          submission_name: 'submission-1',
          status: 'materialization_failed',
          mapped_values: [
            {
              mappingId: 'agreement-number',
              sourceQuestionId: 'agreement_number',
              destinationEntity: 'claim',
              destinationPath: 'egcs_fc_fundingagreement',
              value: 'AGR-MISSING'
            }
          ],
          mapping_issues: [
            {
              mappingId: 'agreement-number',
              sourceQuestionId: 'agreement_number',
              destinationPath: 'claim.egcs_fc_fundingagreement',
              code: 'agreement_not_found',
              message: 'Agreement number could not be resolved in the configured transfer payment stream.'
            }
          ],
          last_error: 'Agreement number could not be resolved in the configured transfer payment stream.'
        },
        {
          id: '902',
          connection_id: '801',
          integration_id: '601',
          form_id: 'form-1',
          submission_name: 'submission-2',
          status: 'materialization_failed',
          mapped_values: [],
          mapping_issues: [
            {
              mappingId: 'fiscal-year',
              sourceQuestionId: 'fiscal_year',
              destinationPath: 'claim.egcs_fc_fiscalyear',
              code: 'invalid_value',
              message: 'Claim fiscal year is not valid for the resolved agreement.'
            }
          ],
          last_error: 'Claim fiscal year is not valid for the resolved agreement.'
        }
      ])
      .execute()
    await db
      .insertInto('extensions.gcs_gcforms_materialization_overrides')
      .values({
        submission_id: '901',
        destination_entity: 'claim',
        destination_path: 'egcs_fc_fundingagreement',
        owner_type: 'fundingcaseagreement',
        owner_id: '101'
      })
      .execute()

    const result = await listClaimMaterializationFailures(db, '31')

    expect(result.items).toHaveLength(2)
    expect(result.items).toContainEqual(expect.objectContaining({
      submissionId: '901',
      submissionName: 'submission-1',
      agreementNumber: 'AGR-MISSING',
      selectedAgreementId: '101'
    }))
    expect(result.items).toContainEqual(expect.objectContaining({
      submissionId: '902',
      submissionName: 'submission-2',
      agreementNumber: null,
      selectedAgreementId: null,
      lastError: 'Claim fiscal year is not valid for the resolved agreement.'
    }))
    expect(result.agreements).toEqual([
      {
        id: '101',
        agreementNumber: 'AGR-001',
        label: 'AGR-001'
      }
    ])
  })
})
