/* eslint-disable jsdoc/require-jsdoc -- PostgreSQL integration fixture helpers are described by the executable scenarios. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely'
import { Pool } from 'pg'
import type { GcsGcFormsFieldMapping, GcsGcFormsMappedValue } from '../../shared/gcforms.ts'
import type { GcFormsIntegrationHostDatabase } from '../../server/db.ts'
import { materializeGcFormsClaimSubmission } from '../../server/materialize-claims.ts'

type TestDb = Kysely<GcFormsIntegrationHostDatabase>

const postgresTestUrl = process.env.GCFORMS_POSTGRES_TEST_URL
  ?? process.env.AGREEMENT_CONCURRENCY_POSTGRES_TEST_URL

const requireDisposablePostgresUrl = (): string => {
  if (!postgresTestUrl) {
    throw new Error(
      'GCFORMS_POSTGRES_TEST_URL or AGREEMENT_CONCURRENCY_POSTGRES_TEST_URL is required for the opt-in PostgreSQL suite.'
    )
  }
  if (!new URL(postgresTestUrl).pathname.slice(1).endsWith('_test')) {
    throw new Error('The GC Forms PostgreSQL suite requires a disposable database ending in _test.')
  }
  return postgresTestUrl
}

const db: TestDb = new Kysely<GcFormsIntegrationHostDatabase>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: requireDisposablePostgresUrl(), max: 2 })
  })
})

const mappings: GcsGcFormsFieldMapping[] = [
  { id: 'agreement', sourceQuestionId: 'agreement', destinationEntity: 'claim', destinationPath: 'egcs_fc_fundingagreement', transform: 'string', required: true, onMissing: 'block', onInvalid: 'block' },
  { id: 'fiscal-year', sourceQuestionId: 'fiscal-year', destinationEntity: 'claim', destinationPath: 'egcs_fc_fiscalyear', transform: 'string', required: true, onMissing: 'block', onInvalid: 'block' },
  { id: 'period-start', sourceQuestionId: 'period-start', destinationEntity: 'claim', destinationPath: 'egcs_fc_periodstart', transform: 'number', required: true, onMissing: 'block', onInvalid: 'block' },
  { id: 'period-end', sourceQuestionId: 'period-end', destinationEntity: 'claim', destinationPath: 'egcs_fc_periodend', transform: 'number', required: true, onMissing: 'block', onInvalid: 'block' },
  { id: 'received', sourceQuestionId: 'received', destinationEntity: 'claim', destinationPath: 'egcs_fc_receiveddate', transform: 'date', required: true, onMissing: 'block', onInvalid: 'block' },
  { id: 'budget-line', sourceQuestionId: 'budget-line', destinationEntity: 'claim_line_item', destinationPath: 'egcs_fc_fundingagreementbudgetlineitem', transform: 'string', required: false, onMissing: 'skip', onInvalid: 'skip' },
  { id: 'category', sourceQuestionId: 'category', destinationEntity: 'claim_line_item', destinationPath: 'egcs_fc_submittedcostcategory', transform: 'string', required: true, onMissing: 'block', onInvalid: 'block' },
  { id: 'subsection', sourceQuestionId: 'subsection', destinationEntity: 'claim_line_item', destinationPath: 'egcs_fc_submittedcostsubsection', transform: 'string', required: true, onMissing: 'block', onInvalid: 'block' },
  { id: 'line', sourceQuestionId: 'line', destinationEntity: 'claim_line_item', destinationPath: 'egcs_fc_submittedlineitem', transform: 'string', required: true, onMissing: 'block', onInvalid: 'block' },
  { id: 'amount', sourceQuestionId: 'amount', destinationEntity: 'claim_line_item', destinationPath: 'egcs_fc_amount', transform: 'money', required: true, onMissing: 'block', onInvalid: 'block' }
]

const mappedValues: GcsGcFormsMappedValue[] = [
  { mappingId: 'agreement', sourceQuestionId: 'agreement', destinationEntity: 'claim', destinationPath: 'egcs_fc_fundingagreement', value: 'AGR-ATOMIC' },
  { mappingId: 'fiscal-year', sourceQuestionId: 'fiscal-year', destinationEntity: 'claim', destinationPath: 'egcs_fc_fiscalyear', value: '501' },
  { mappingId: 'period-start', sourceQuestionId: 'period-start', destinationEntity: 'claim', destinationPath: 'egcs_fc_periodstart', value: 0 },
  { mappingId: 'period-end', sourceQuestionId: 'period-end', destinationEntity: 'claim', destinationPath: 'egcs_fc_periodend', value: 2 },
  { mappingId: 'received', sourceQuestionId: 'received', destinationEntity: 'claim', destinationPath: 'egcs_fc_receiveddate', value: '2026-05-01T00:00:00.000Z' },
  { mappingId: 'budget-line', sourceQuestionId: 'budget-line', destinationEntity: 'claim_line_item', destinationPath: 'egcs_fc_fundingagreementbudgetlineitem', value: '701' },
  { mappingId: 'category', sourceQuestionId: 'category', destinationEntity: 'claim_line_item', destinationPath: 'egcs_fc_submittedcostcategory', value: 'Operating Costs' },
  { mappingId: 'subsection', sourceQuestionId: 'subsection', destinationEntity: 'claim_line_item', destinationPath: 'egcs_fc_submittedcostsubsection', value: 'Delivery' },
  { mappingId: 'line', sourceQuestionId: 'line', destinationEntity: 'claim_line_item', destinationPath: 'egcs_fc_submittedlineitem', value: 'Travel' },
  { mappingId: 'amount', sourceQuestionId: 'amount', destinationEntity: 'claim_line_item', destinationPath: 'egcs_fc_amount', value: '1234.56' }
]

const createSchema = async () => {
  await sql`DROP SCHEMA IF EXISTS extensions CASCADE`.execute(db)
  await sql`CREATE SCHEMA extensions`.execute(db)
  await sql`DROP TABLE IF EXISTS "Common_Entity_Assignment", "Funding_Case_Agreement_Claim_Line_Item", "Funding_Case_Agreement_Claim", "Funding_Case_Agreement_Budget_Line_Item", "Transfer_Payment_Stream_Cost_Category_Line_Item", "Agency_Cost_Category_Line_Item", "Agency_Cost_Category", "Funding_Case_Agreement_Budget_Fiscal_Year", "Agency_Fiscal_Year", "Funding_Case_Agreement_Profile" CASCADE`.execute(db)
  await sql`CREATE TABLE "Funding_Case_Agreement_Profile" (id bigserial PRIMARY KEY, egcs_fc_agreementnumber varchar(30) NOT NULL, egcs_fc_transferpaymentstream bigint NOT NULL, _deleted boolean NOT NULL DEFAULT false)`.execute(db)
  await sql`CREATE TABLE "Agency_Fiscal_Year" (id bigserial PRIMARY KEY, egcs_ay_fiscalyeardisplay varchar(20) NOT NULL, _deleted boolean NOT NULL DEFAULT false)`.execute(db)
  await sql`CREATE TABLE "Funding_Case_Agreement_Budget_Fiscal_Year" (id bigserial PRIMARY KEY, egcs_fc_fundingagreement bigint NOT NULL, egcs_fc_fiscalyear bigint NOT NULL, _deleted boolean NOT NULL DEFAULT false)`.execute(db)
  await sql`CREATE TABLE "Agency_Cost_Category" (id bigserial PRIMARY KEY, egcs_ay_name_en text NOT NULL, egcs_ay_name_fr text NOT NULL, _deleted boolean NOT NULL DEFAULT false)`.execute(db)
  await sql`CREATE TABLE "Agency_Cost_Category_Line_Item" (id bigserial PRIMARY KEY, egcs_ay_name_en text NOT NULL, egcs_ay_name_fr text NOT NULL, egcs_ay_organizationcostcategory bigint NOT NULL, _deleted boolean NOT NULL DEFAULT false)`.execute(db)
  await sql`CREATE TABLE "Transfer_Payment_Stream_Cost_Category_Line_Item" (id bigserial PRIMARY KEY, egcs_tp_transferpaymentstream bigint NOT NULL, egcs_tp_organizationcostcategory bigint NOT NULL, _deleted boolean NOT NULL DEFAULT false)`.execute(db)
  await sql`CREATE TABLE "Funding_Case_Agreement_Budget_Line_Item" (id bigserial PRIMARY KEY, egcs_fc_fundingagreementbudgetfiscalyear bigint NOT NULL, egcs_fc_organizationcostcategory bigint NOT NULL, egcs_fc_costsubsection text NOT NULL, egcs_fc_description text NOT NULL, _deleted boolean NOT NULL DEFAULT false)`.execute(db)
  await sql`CREATE TABLE "Funding_Case_Agreement_Claim" (id bigserial PRIMARY KEY, egcs_fc_fundingagreement bigint NOT NULL, egcs_fc_fiscalyear bigint NOT NULL, egcs_fc_isfinalforyear boolean NOT NULL, egcs_fc_periodend smallint NOT NULL, egcs_fc_periodstart smallint NOT NULL, egcs_fc_receiveddate timestamptz NOT NULL, egcs_fc_gcformssubmissionuuid varchar(80), egcs_fc_status bigint NOT NULL, _deleted boolean NOT NULL DEFAULT false)`.execute(db)
  await sql`CREATE TABLE "Funding_Case_Agreement_Claim_Line_Item" (id bigserial PRIMARY KEY, egcs_fc_fundingagreementclaim bigint NOT NULL, egcs_fc_fundingagreementbudgetlineitem bigint, egcs_fc_submittedcostcategory text, egcs_fc_submittedcostsubsection text, egcs_fc_submittedlineitem text, egcs_fc_description text NOT NULL, egcs_fc_amount numeric(19,2) NOT NULL, egcs_fc_currency varchar(3) NOT NULL, _deleted boolean NOT NULL DEFAULT false)`.execute(db)
  await sql`CREATE TABLE "Common_Entity_Assignment" (id bigserial PRIMARY KEY, egcs_cn_entityid bigint NOT NULL, egcs_cn_entitytype varchar(80) NOT NULL, egcs_cn_user bigint NOT NULL, egcs_cn_isprimary boolean NOT NULL, _deleted boolean NOT NULL DEFAULT false)`.execute(db)
  await sql`CREATE TABLE extensions.gcs_gcforms_field_mappings (id bigserial PRIMARY KEY, integration_id bigint NOT NULL, mapping_key varchar(120) NOT NULL, source_question_id varchar(200) NOT NULL, destination_entity varchar(60) NOT NULL, destination_path varchar(240) NOT NULL, transform varchar(40) NOT NULL, required boolean NOT NULL, default_value jsonb, on_missing varchar(20) NOT NULL, on_invalid varchar(20) NOT NULL, _deleted boolean NOT NULL DEFAULT false)`.execute(db)
  await sql`CREATE TABLE extensions.gcs_gcforms_submissions (id bigserial PRIMARY KEY, connection_id bigint NOT NULL, integration_id bigint, form_id varchar(80) NOT NULL, submission_name varchar(80) NOT NULL, status varchar(40) NOT NULL, _deleted boolean NOT NULL DEFAULT false)`.execute(db)
  await sql`CREATE TABLE extensions.gcs_gcforms_destination_links (id bigserial PRIMARY KEY, submission_id bigint NOT NULL, mapping_id bigint, owner_type varchar(80) NOT NULL, owner_id bigint NOT NULL, destination_entity varchar(60) NOT NULL, destination_path varchar(240) NOT NULL, value jsonb, _deleted boolean NOT NULL DEFAULT false)`.execute(db)
  await sql`CREATE TABLE extensions.gcs_gcforms_materialization_overrides (id bigserial PRIMARY KEY, submission_id bigint NOT NULL, destination_entity varchar(60) NOT NULL, destination_path varchar(240) NOT NULL, owner_type varchar(80) NOT NULL, owner_id bigint NOT NULL, _deleted boolean NOT NULL DEFAULT false)`.execute(db)
}

const seed = async () => {
  await sql`INSERT INTO "Funding_Case_Agreement_Profile" VALUES (101, 'AGR-ATOMIC', 31, false)`.execute(db)
  await sql`INSERT INTO "Agency_Fiscal_Year" VALUES (401, '2025-2026', false)`.execute(db)
  await sql`INSERT INTO "Funding_Case_Agreement_Budget_Fiscal_Year" VALUES (501, 101, 401, false)`.execute(db)
  await sql`INSERT INTO "Agency_Cost_Category" VALUES (301, 'Operating Costs', 'Frais de fonctionnement', false)`.execute(db)
  await sql`INSERT INTO "Agency_Cost_Category_Line_Item" VALUES (601, 'Travel', 'Déplacement', 301, false)`.execute(db)
  await sql`INSERT INTO "Transfer_Payment_Stream_Cost_Category_Line_Item" VALUES (801, 31, 601, false)`.execute(db)
  await sql`INSERT INTO "Funding_Case_Agreement_Budget_Line_Item" VALUES (701, 501, 801, 'Delivery', 'Travel', false)`.execute(db)
  await sql`INSERT INTO extensions.gcs_gcforms_submissions VALUES (901, 801, 601, 'form', 'submission-atomic', 'mapped', false)`.execute(db)
  for (const [index, mapping] of mappings.entries()) {
    await db.insertInto('extensions.gcs_gcforms_field_mappings').values({
      id: String(1000 + index), integration_id: '601', mapping_key: mapping.id,
      source_question_id: mapping.sourceQuestionId, destination_entity: mapping.destinationEntity,
      destination_path: mapping.destinationPath, transform: mapping.transform, required: mapping.required,
      default_value: null, on_missing: mapping.onMissing, on_invalid: mapping.onInvalid
    }).execute()
  }
}

const insertHostAggregate = async (
  trx: Transaction<GcFormsIntegrationHostDatabase>,
  input: Parameters<Parameters<typeof materializeGcFormsClaimSubmission>[1]['createAgreementClaim']>[0]
) => {
  const claim = await trx.insertInto('Funding_Case_Agreement_Claim').values({
    egcs_fc_fundingagreement: input.agreementId, egcs_fc_fiscalyear: input.fiscalYearId,
    egcs_fc_isfinalforyear: input.isFinalForYear, egcs_fc_periodstart: input.periodStart,
    egcs_fc_periodend: input.periodEnd, egcs_fc_receiveddate: input.receivedDate,
    egcs_fc_gcformssubmissionuuid: input.submissionUuid, egcs_fc_status: input.expectedDraftStatusId ?? '91'
  }).returning('id').executeTakeFirstOrThrow()
  await sql`INSERT INTO "Common_Entity_Assignment" (egcs_cn_entityid, egcs_cn_entitytype, egcs_cn_user, egcs_cn_isprimary) VALUES (${String(claim.id)}::bigint, 'fundingcaseagreementclaim', 9001, true)`.execute(trx)
  const lineItemIds: string[] = []
  for (const line of input.lineItems) {
    const created = await trx.insertInto('Funding_Case_Agreement_Claim_Line_Item').values({
      egcs_fc_fundingagreementclaim: String(claim.id),
      egcs_fc_fundingagreementbudgetlineitem: line.budgetLineItemId,
      egcs_fc_submittedcostcategory: line.submittedCostCategory,
      egcs_fc_submittedcostsubsection: line.submittedCostSubsection,
      egcs_fc_submittedlineitem: line.submittedLineItem,
      egcs_fc_description: line.description,
      egcs_fc_amount: line.amount,
      egcs_fc_currency: line.currency
    }).returning('id').executeTakeFirstOrThrow()
    lineItemIds.push(String(created.id))
  }
  return { status: 'created' as const, claimId: String(claim.id), lineItemIds, draftStatusId: '91' }
}

const materialize = async (
  mode: 'success' | 'callback_failure' = 'success',
  values: GcsGcFormsMappedValue[] = mappedValues
) => await db.transaction().execute(async trx =>
  await materializeGcFormsClaimSubmission(trx, {
    agencyId: '20', streamId: '31', integrationId: '601', submissionId: '901',
    submissionUuid: 'submission-atomic', submissionStatusId: '91', mappings, mappedValues: values,
    createAgreementClaim: async input => {
      const result = await insertHostAggregate(trx, input)
      if (mode === 'callback_failure') throw new Error('host callback failed')
      return result
    }
  }))

const counts = async () => ({
  claims: Number((await sql<{ count: string }>`SELECT count(*)::text AS count FROM "Funding_Case_Agreement_Claim"`.execute(db)).rows[0]?.count),
  lines: Number((await sql<{ count: string }>`SELECT count(*)::text AS count FROM "Funding_Case_Agreement_Claim_Line_Item"`.execute(db)).rows[0]?.count),
  assignments: Number((await sql<{ count: string }>`SELECT count(*)::text AS count FROM "Common_Entity_Assignment"`.execute(db)).rows[0]?.count),
  links: Number((await sql<{ count: string }>`SELECT count(*)::text AS count FROM extensions.gcs_gcforms_destination_links`.execute(db)).rows[0]?.count)
})

describe('GC Forms PostgreSQL Claim transaction handoff', () => {
  beforeAll(async () => {
    await createSchema()
  })

  beforeEach(async () => {
    await sql`TRUNCATE TABLE "Common_Entity_Assignment", "Funding_Case_Agreement_Claim_Line_Item", "Funding_Case_Agreement_Claim", "Funding_Case_Agreement_Budget_Line_Item", "Transfer_Payment_Stream_Cost_Category_Line_Item", "Agency_Cost_Category_Line_Item", "Agency_Cost_Category", "Funding_Case_Agreement_Budget_Fiscal_Year", "Agency_Fiscal_Year", "Funding_Case_Agreement_Profile", extensions.gcs_gcforms_destination_links, extensions.gcs_gcforms_field_mappings, extensions.gcs_gcforms_submissions RESTART IDENTITY`.execute(db)
    await sql`ALTER TABLE extensions.gcs_gcforms_destination_links DROP CONSTRAINT IF EXISTS reject_line_link`.execute(db)
    await seed()
  })

  afterAll(async () => {
    await sql`DROP SCHEMA IF EXISTS extensions CASCADE`.execute(db)
    await sql`DROP TABLE IF EXISTS "Common_Entity_Assignment", "Funding_Case_Agreement_Claim_Line_Item", "Funding_Case_Agreement_Claim", "Funding_Case_Agreement_Budget_Line_Item", "Transfer_Payment_Stream_Cost_Category_Line_Item", "Agency_Cost_Category_Line_Item", "Agency_Cost_Category", "Funding_Case_Agreement_Budget_Fiscal_Year", "Agency_Fiscal_Year", "Funding_Case_Agreement_Profile" CASCADE`.execute(db)
    const residue = await sql<{ count: string }>`SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'extensions' OR table_name IN ('Funding_Case_Agreement_Claim', 'Funding_Case_Agreement_Claim_Line_Item', 'Common_Entity_Assignment')`.execute(db)
    expect(residue.rows[0]?.count).toBe('0')
    await db.destroy()
  })

  it('commits the host aggregate, creator-primary assignment, and extension links together', async () => {
    await expect(materialize()).resolves.toMatchObject({ status: 'created', lineItemIds: ['1'] })
    await expect(counts()).resolves.toEqual({ claims: 1, lines: 1, assignments: 1, links: 2 })
    const links = await sql<{ owner_type: string, owner_id: string }>`SELECT owner_type, owner_id::text FROM extensions.gcs_gcforms_destination_links ORDER BY id`.execute(db)
    expect(links.rows).toEqual([
      { owner_type: 'fundingcaseagreementclaim', owner_id: '1' },
      { owner_type: 'fundingcaseagreementclaimlineitem', owner_id: '1' }
    ])
  })

  it.each(['0.10', '-0.20', '99999999999999999.99'])(
    'preserves exact mapped Claim money %s through the host row and destination evidence',
    async amount => {
      const values = mappedValues.map(value => value.mappingId === 'amount' ? { ...value, value: amount } : value)
      await expect(materialize('success', values)).resolves.toMatchObject({ status: 'created', lineItemIds: ['1'] })
      const line = await sql<{ amount: string }>`SELECT egcs_fc_amount::text AS amount FROM "Funding_Case_Agreement_Claim_Line_Item"`.execute(db)
      expect(line.rows).toEqual([{ amount }])
      const evidence = await sql<{ value: { amount?: string } }>`SELECT value FROM extensions.gcs_gcforms_destination_links WHERE destination_entity = 'claim_line_item'`.execute(db)
      expect(evidence.rows[0]?.value.amount).toBe(amount)
      await expect(counts()).resolves.toEqual({ claims: 1, lines: 1, assignments: 1, links: 2 })
    }
  )

  it.each(['0.001', '1e2', '100000000000000000.00'])(
    'rejects invalid mapped Claim money %s before any host or destination write',
    async amount => {
      const values = mappedValues.map(value => value.mappingId === 'amount' ? { ...value, value: amount } : value)
      await expect(materialize('success', values)).resolves.toMatchObject({ status: 'failed', lineItemIds: [] })
      await expect(counts()).resolves.toEqual({ claims: 0, lines: 0, assignments: 0, links: 0 })
    }
  )

  it('rolls back all host and extension rows when the host callback fails after inserts', async () => {
    await expect(materialize('callback_failure')).rejects.toThrow('host callback failed')
    await expect(counts()).resolves.toEqual({ claims: 0, lines: 0, assignments: 0, links: 0 })
  })

  it('rolls back all host and extension rows when a later extension link fails', async () => {
    await sql`ALTER TABLE extensions.gcs_gcforms_destination_links ADD CONSTRAINT reject_line_link CHECK (destination_entity <> 'claim_line_item')`.execute(db)
    await expect(materialize()).rejects.toMatchObject({ code: '23514' })
    await expect(counts()).resolves.toEqual({ claims: 0, lines: 0, assignments: 0, links: 0 })
  })
})
