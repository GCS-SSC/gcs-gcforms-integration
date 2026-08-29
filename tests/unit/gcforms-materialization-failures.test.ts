import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import type { GcFormsIntegrationHostDatabase } from '../../server/db'
import { listClaimMaterializationFailures } from '../../server/materialization-failures'

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
    CREATE TABLE extensions.gcs_gcforms_connections (
      id bigserial PRIMARY KEY,
      stream_id bigint NOT NULL
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
      diagnostic_code varchar(100),
      diagnostic_params jsonb,
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
    await sql`
      INSERT INTO extensions.gcs_gcforms_connections (id, stream_id)
      VALUES (801, 31)
    `.execute(db)
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
        },
        {
          id: '103',
          egcs_fc_agreementnumber: 'AGR-HIDDEN',
          egcs_fc_transferpaymentstream: '31'
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
              params: { destinationPath: 'claim.egcs_fc_fundingagreement' }
            }
          ],
          diagnostic_code: 'agreement_not_found',
          diagnostic_params: { destinationPath: 'claim.egcs_fc_fundingagreement' }
        },
        {
          id: '902',
          connection_id: '801',
          integration_id: '601',
          form_id: 'form-1',
          submission_name: 'submission-2',
          status: 'materialization_failed',
          mapped_values: [
            null,
            {},
            { mappingId: 'incomplete-1' },
            { mappingId: 'incomplete-2', sourceQuestionId: 'source' },
            {
              mappingId: 'incomplete-3',
              sourceQuestionId: 'source',
              destinationEntity: 'claim'
            },
            {
              mappingId: 'agreement-id-not-text',
              sourceQuestionId: 'agreement',
              destinationEntity: 'claim',
              destinationPath: 'egcs_fc_fundingagreement',
              value: 101
            }
          ],
          mapping_issues: [
            {
              mappingId: 'fiscal-year',
              sourceQuestionId: 'fiscal_year',
              destinationPath: 'claim.egcs_fc_fiscalyear',
              code: 'claim_fiscal_year_invalid',
              params: { destinationPath: 'claim.egcs_fc_fiscalyear' }
            }
          ],
          diagnostic_code: 'claim_fiscal_year_invalid',
          diagnostic_params: { destinationPath: 'claim.egcs_fc_fiscalyear' }
        },
        {
          id: '903',
          connection_id: '801',
          integration_id: '601',
          form_id: 'form-1',
          submission_name: 'submission-3',
          status: 'materialization_failed',
          mapped_values: null,
          mapping_issues: null
        },
        {
          id: '904',
          connection_id: '801',
          integration_id: '601',
          form_id: 'form-1',
          submission_name: 'submission-4',
          status: 'materialization_failed',
          mapped_values: [{
            mappingId: 'agreement-number-prefixed',
            sourceQuestionId: 'agreement',
            destinationEntity: 'claim',
            destinationPath: 'claim.egcs_fc_fundingagreement',
            value: 'AGR-PREFIXED'
          }],
          mapping_issues: []
        }
      ])
      .execute()
    await db
      .insertInto('extensions.gcs_gcforms_materialization_overrides')
      .values([
        {
          submission_id: '901',
          destination_entity: 'claim',
          destination_path: 'egcs_fc_fundingagreement',
          owner_type: 'fundingcaseagreement',
          owner_id: '103'
        },
        {
          submission_id: '902',
          destination_entity: 'claim',
          destination_path: 'egcs_fc_fundingagreement',
          owner_type: 'fundingcaseagreement',
          owner_id: '101'
        }
      ])
      .execute()

    const listVisibleOptions = vi.fn(async () => [{
      id: '101',
      agreementNumber: 'AGR-001',
      label: 'AGR-001'
    }])
    const result = await listClaimMaterializationFailures({
      db,
      getHeader: (name: string) => name === 'accept-language' ? 'fr-CA,fr;q=0.9,en;q=0.5' : undefined,
      agreementAccess: { listVisibleOptions }
    } as any, '31')

    expect(result.items).toHaveLength(4)
    expect(result.items).toContainEqual(expect.objectContaining({
      submissionId: '901',
      submissionName: 'submission-1',
      agreementNumber: 'AGR-MISSING',
      selectedAgreementId: null
    }))
    expect(result.items).toContainEqual(expect.objectContaining({
      submissionId: '902',
      submissionName: 'submission-2',
      agreementNumber: null,
      selectedAgreementId: '101',
      diagnostic: {
        code: 'claim_fiscal_year_invalid',
        params: { destinationPath: 'claim.egcs_fc_fiscalyear' },
        message: 'L’exercice financier de la réclamation pour claim.egcs_fc_fiscalyear n’est pas valide pour l’entente résolue.'
      },
      issues: [{
        mappingId: 'fiscal-year',
        sourceQuestionId: 'fiscal_year',
        destinationPath: 'claim.egcs_fc_fiscalyear',
        code: 'claim_fiscal_year_invalid',
        params: { destinationPath: 'claim.egcs_fc_fiscalyear' },
        message: 'L’exercice financier de la réclamation pour claim.egcs_fc_fiscalyear n’est pas valide pour l’entente résolue.'
      }]
    }))
    expect(result.items).toContainEqual(expect.objectContaining({
      submissionId: '903',
      agreementNumber: null,
      selectedAgreementId: null,
      diagnostic: null,
      issues: []
    }))
    expect(result.items).toContainEqual(expect.objectContaining({
      submissionId: '904',
      agreementNumber: 'AGR-PREFIXED',
      selectedAgreementId: null
    }))
    expect(result.agreements).toEqual([
      {
        id: '101',
        agreementNumber: 'AGR-001',
        label: 'AGR-001'
      }
    ])
    expect(listVisibleOptions).toHaveBeenCalledWith(db, { streamId: '31', action: 'read' })
  })

  it('rejects a failure listing when the host agreement visibility capability is absent', async () => {
    await expect(listClaimMaterializationFailures({ db } as any, '31'))
      .rejects.toThrow('GC Forms agreement options require host-provided agreement visibility.')
  })
})
