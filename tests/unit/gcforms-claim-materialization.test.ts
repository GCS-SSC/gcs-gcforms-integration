import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import type { GcsGcFormsFieldMapping, GcsGcFormsMappedValue } from '../../shared/gcforms'
import type { GcFormsIntegrationHostDatabase } from '../../server/db'
import { materializeGcFormsClaimSubmission } from '../../server/materialize-claims'

type TestDb = Kysely<GcFormsIntegrationHostDatabase>

let db: TestDb

const claimMappings: GcsGcFormsFieldMapping[] = [
  {
    id: 'agreement-number',
    sourceQuestionId: 'agreement_number',
    destinationEntity: 'claim',
    destinationPath: 'egcs_fc_fundingagreement',
    transform: 'string',
    required: true,
    onMissing: 'block',
    onInvalid: 'block'
  },
  {
    id: 'fiscal-year',
    sourceQuestionId: 'fiscal_year',
    destinationEntity: 'claim',
    destinationPath: 'egcs_fc_fiscalyear',
    transform: 'string',
    required: true,
    onMissing: 'block',
    onInvalid: 'block'
  },
  {
    id: 'final-for-year',
    sourceQuestionId: 'final_for_year',
    destinationEntity: 'claim',
    destinationPath: 'egcs_fc_isfinalforyear',
    transform: 'boolean',
    required: true,
    onMissing: 'block',
    onInvalid: 'block'
  },
  {
    id: 'period-start',
    sourceQuestionId: 'period_start',
    destinationEntity: 'claim',
    destinationPath: 'egcs_fc_periodstart',
    transform: 'number',
    required: true,
    onMissing: 'block',
    onInvalid: 'block'
  },
  {
    id: 'period-end',
    sourceQuestionId: 'period_end',
    destinationEntity: 'claim',
    destinationPath: 'egcs_fc_periodend',
    transform: 'number',
    required: true,
    onMissing: 'block',
    onInvalid: 'block'
  },
  {
    id: 'received-date',
    sourceQuestionId: 'received_date',
    destinationEntity: 'claim',
    destinationPath: 'egcs_fc_receiveddate',
    transform: 'date',
    required: true,
    onMissing: 'block',
    onInvalid: 'block'
  }
]

const lineItemMappings: GcsGcFormsFieldMapping[] = [
  {
    id: 'budget-line',
    sourceQuestionId: 'budget_line',
    destinationEntity: 'claim_line_item',
    destinationPath: 'egcs_fc_fundingagreementbudgetlineitem',
    transform: 'string',
    required: false,
    onMissing: 'skip',
    onInvalid: 'skip'
  },
  {
    id: 'submitted-category',
    sourceQuestionId: 'submitted_cost_category',
    destinationEntity: 'claim_line_item',
    destinationPath: 'egcs_fc_submittedcostcategory',
    transform: 'string',
    required: true,
    onMissing: 'block',
    onInvalid: 'block'
  },
  {
    id: 'submitted-subsection',
    sourceQuestionId: 'submitted_cost_subsection',
    destinationEntity: 'claim_line_item',
    destinationPath: 'egcs_fc_submittedcostsubsection',
    transform: 'string',
    required: true,
    onMissing: 'block',
    onInvalid: 'block'
  },
  {
    id: 'submitted-line-item',
    sourceQuestionId: 'submitted_line_item',
    destinationEntity: 'claim_line_item',
    destinationPath: 'egcs_fc_submittedlineitem',
    transform: 'string',
    required: true,
    onMissing: 'block',
    onInvalid: 'block'
  },
  {
    id: 'line-amount',
    sourceQuestionId: 'submitted_amount',
    destinationEntity: 'claim_line_item',
    destinationPath: 'egcs_fc_amount',
    transform: 'money',
    required: true,
    onMissing: 'block',
    onInvalid: 'block'
  }
]

const claimValues: GcsGcFormsMappedValue[] = [
  {
    mappingId: 'agreement-number',
    sourceQuestionId: 'agreement_number',
    destinationEntity: 'claim',
    destinationPath: 'egcs_fc_fundingagreement',
    value: 'AGR-001'
  },
  {
    mappingId: 'fiscal-year',
    sourceQuestionId: 'fiscal_year',
    destinationEntity: 'claim',
    destinationPath: 'egcs_fc_fiscalyear',
    value: '501'
  },
  {
    mappingId: 'final-for-year',
    sourceQuestionId: 'final_for_year',
    destinationEntity: 'claim',
    destinationPath: 'egcs_fc_isfinalforyear',
    value: false
  },
  {
    mappingId: 'period-start',
    sourceQuestionId: 'period_start',
    destinationEntity: 'claim',
    destinationPath: 'egcs_fc_periodstart',
    value: 0
  },
  {
    mappingId: 'period-end',
    sourceQuestionId: 'period_end',
    destinationEntity: 'claim',
    destinationPath: 'egcs_fc_periodend',
    value: 2
  },
  {
    mappingId: 'received-date',
    sourceQuestionId: 'received_date',
    destinationEntity: 'claim',
    destinationPath: 'egcs_fc_receiveddate',
    value: '2026-05-01T00:00:00.000Z'
  }
]

const lineItemValues: GcsGcFormsMappedValue[] = [
  {
    mappingId: 'budget-line',
    sourceQuestionId: 'budget_line',
    destinationEntity: 'claim_line_item',
    destinationPath: 'egcs_fc_fundingagreementbudgetlineitem',
    value: '701'
  },
  {
    mappingId: 'submitted-category',
    sourceQuestionId: 'submitted_cost_category',
    destinationEntity: 'claim_line_item',
    destinationPath: 'egcs_fc_submittedcostcategory',
    value: 'Operating Costs'
  },
  {
    mappingId: 'submitted-subsection',
    sourceQuestionId: 'submitted_cost_subsection',
    destinationEntity: 'claim_line_item',
    destinationPath: 'egcs_fc_submittedcostsubsection',
    value: 'Delivery'
  },
  {
    mappingId: 'submitted-line-item',
    sourceQuestionId: 'submitted_line_item',
    destinationEntity: 'claim_line_item',
    destinationPath: 'egcs_fc_submittedlineitem',
    value: 'Travel'
  },
  {
    mappingId: 'line-amount',
    sourceQuestionId: 'submitted_amount',
    destinationEntity: 'claim_line_item',
    destinationPath: 'egcs_fc_amount',
    value: 1234.56
  }
]

const withDestinationPathPrefix = (
  mapping: GcsGcFormsFieldMapping
): GcsGcFormsFieldMapping => ({
  ...mapping,
  destinationPath: `${mapping.destinationEntity}.${mapping.destinationPath}`
})

const withMappedDestinationPathPrefix = (
  value: GcsGcFormsMappedValue
): GcsGcFormsMappedValue => ({
  ...value,
  destinationPath: `${value.destinationEntity}.${value.destinationPath}`
})

const withTableDestinationPathPrefix = (
  mapping: GcsGcFormsFieldMapping
): GcsGcFormsFieldMapping => ({
  ...mapping,
  destinationPath: mapping.destinationEntity === 'claim'
    ? `Funding_Case_Agreement_Claim.${mapping.destinationPath}`
    : `Funding_Case_Agreement_Claim_Line_Item.${mapping.destinationPath}`
})

const withMappedTableDestinationPathPrefix = (
  value: GcsGcFormsMappedValue
): GcsGcFormsMappedValue => ({
  ...value,
  destinationPath: value.destinationEntity === 'claim'
    ? `Funding_Case_Agreement_Claim.${value.destinationPath}`
    : `Funding_Case_Agreement_Claim_Line_Item.${value.destinationPath}`
})

const createSchema = async () => {
  await sql`CREATE SCHEMA extensions`.execute(db)
  await sql`
    CREATE TABLE "Common_Status" (
      id bigserial PRIMARY KEY,
      egcs_cn_agency bigint NOT NULL,
      egcs_cn_isdraft boolean DEFAULT false NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE "Funding_Case_Agreement_Profile" (
      id bigserial PRIMARY KEY,
      egcs_fc_agreementnumber varchar(15) NOT NULL,
      egcs_fc_transferpaymentstream bigint NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE "Agency_Fiscal_Year" (
      id bigserial PRIMARY KEY,
      egcs_ay_fiscalyeardisplay varchar(20) NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE "Funding_Case_Agreement_Budget_Fiscal_Year" (
      id bigserial PRIMARY KEY,
      egcs_fc_fundingagreement bigint NOT NULL,
      egcs_fc_fiscalyear bigint NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE "Agency_Cost_Category" (
      id bigserial PRIMARY KEY,
      egcs_ay_name_en varchar(255) NOT NULL,
      egcs_ay_name_fr varchar(255) NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE "Agency_Cost_Category_Line_Item" (
      id bigserial PRIMARY KEY,
      egcs_ay_name_en varchar(255) NOT NULL,
      egcs_ay_name_fr varchar(255) NOT NULL,
      egcs_ay_organizationcostcategory bigint NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE "Transfer_Payment_Stream_Cost_Category_Line_Item" (
      id bigserial PRIMARY KEY,
      egcs_tp_transferpaymentstream bigint NOT NULL,
      egcs_tp_organizationcostcategory bigint NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE "Funding_Case_Agreement_Budget_Line_Item" (
      id bigserial PRIMARY KEY,
      egcs_fc_fundingagreementbudgetfiscalyear bigint NOT NULL,
      egcs_fc_organizationcostcategory bigint NOT NULL,
      egcs_fc_costsubsection varchar(255) NOT NULL,
      egcs_fc_description text NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE "Funding_Case_Agreement_Claim" (
      id bigserial PRIMARY KEY,
      egcs_fc_fundingagreement bigint NOT NULL,
      egcs_fc_fiscalyear bigint NOT NULL,
      egcs_fc_isfinalforyear boolean NOT NULL,
      egcs_fc_periodend smallint NOT NULL,
      egcs_fc_periodstart smallint NOT NULL,
      egcs_fc_receiveddate timestamptz NOT NULL,
      egcs_fc_gcformssubmissionuuid varchar(80),
      egcs_fc_status varchar(40) NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE "Funding_Case_Agreement_Claim_Line_Item" (
      id bigserial PRIMARY KEY,
      egcs_fc_fundingagreementclaim bigint NOT NULL,
      egcs_fc_fundingagreementbudgetlineitem bigint,
      egcs_fc_submittedcostcategory text,
      egcs_fc_submittedcostsubsection text,
      egcs_fc_submittedlineitem text,
      egcs_fc_description text NOT NULL,
      egcs_fc_amount numeric(19, 2) NOT NULL,
      egcs_fc_currency varchar(3) NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE extensions.gcs_gcforms_field_mappings (
      id bigserial PRIMARY KEY,
      integration_id bigint NOT NULL,
      mapping_key varchar(120) NOT NULL,
      source_question_id varchar(200) NOT NULL,
      destination_entity varchar(60) NOT NULL,
      destination_path varchar(240) NOT NULL,
      transform varchar(40) NOT NULL,
      required boolean DEFAULT false NOT NULL,
      default_value jsonb,
      on_missing varchar(20) DEFAULT 'block' NOT NULL,
      on_invalid varchar(20) DEFAULT 'block' NOT NULL,
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
      diagnostic_code varchar(100),
      diagnostic_params jsonb,
      confirmed_at timestamptz,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE extensions.gcs_gcforms_destination_links (
      id bigserial PRIMARY KEY,
      submission_id bigint NOT NULL,
      mapping_id bigint,
      owner_type varchar(80) NOT NULL,
      owner_id bigint NOT NULL,
      destination_entity varchar(60) NOT NULL,
      destination_path varchar(240) NOT NULL,
      value jsonb,
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

const seedBaseData = async () => {
  await db
    .insertInto('Common_Status')
    .values({
      id: '91',
      egcs_cn_agency: '20',
      egcs_cn_isdraft: true
    })
    .execute()
  await db
    .insertInto('Common_Status')
    .values([
      {
        id: '92',
        egcs_cn_agency: '21'
      },
      {
        id: '93',
        egcs_cn_agency: '20',
        _deleted: true
      }
    ])
    .execute()
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
        egcs_fc_agreementnumber: 'AGR-001',
        egcs_fc_transferpaymentstream: '32'
      }
    ])
    .execute()
  await db
    .insertInto('Agency_Fiscal_Year')
    .values([
      {
        id: '401',
        egcs_ay_fiscalyeardisplay: '2025-2026'
      },
      {
        id: '402',
        egcs_ay_fiscalyeardisplay: '2026-2027'
      }
    ])
    .execute()
  await db
    .insertInto('Funding_Case_Agreement_Budget_Fiscal_Year')
    .values([
      {
        id: '501',
        egcs_fc_fundingagreement: '101',
        egcs_fc_fiscalyear: '401'
      },
      {
        id: '502',
        egcs_fc_fundingagreement: '102',
        egcs_fc_fiscalyear: '402'
      }
    ])
    .execute()
  await db
    .insertInto('Agency_Cost_Category')
    .values({
      id: '301',
      egcs_ay_name_en: 'Operating Costs',
      egcs_ay_name_fr: 'Couts de fonctionnement'
    })
    .execute()
  await db
    .insertInto('Agency_Cost_Category_Line_Item')
    .values([
      {
        id: '601',
        egcs_ay_name_en: 'Travel',
        egcs_ay_name_fr: 'Deplacement',
        egcs_ay_organizationcostcategory: '301'
      },
      {
        id: '602',
        egcs_ay_name_en: 'Equipment',
        egcs_ay_name_fr: 'Equipement',
        egcs_ay_organizationcostcategory: '301'
      }
    ])
    .execute()
  await db
    .insertInto('Transfer_Payment_Stream_Cost_Category_Line_Item')
    .values([
      {
        id: '801',
        egcs_tp_transferpaymentstream: '31',
        egcs_tp_organizationcostcategory: '601'
      },
      {
        id: '802',
        egcs_tp_transferpaymentstream: '31',
        egcs_tp_organizationcostcategory: '602'
      }
    ])
    .execute()
  await db
    .insertInto('Funding_Case_Agreement_Budget_Line_Item')
    .values([
      {
        id: '701',
        egcs_fc_fundingagreementbudgetfiscalyear: '501',
        egcs_fc_organizationcostcategory: '801',
        egcs_fc_costsubsection: 'Delivery',
        egcs_fc_description: 'Travel'
      },
      {
        id: '702',
        egcs_fc_fundingagreementbudgetfiscalyear: '502',
        egcs_fc_organizationcostcategory: '802',
        egcs_fc_costsubsection: 'Administration',
        egcs_fc_description: 'Equipment'
      }
    ])
    .execute()
  await seedSubmission('901', 'submission-1')
}

const seedSubmission = async (id: string, submissionName: string) => {
  await db
    .insertInto('extensions.gcs_gcforms_submissions')
    .values({
      id,
      connection_id: '801',
      integration_id: '601',
      form_id: 'form-1',
      submission_name: submissionName,
      status: 'mapped'
    })
    .execute()
}

const seedMappings = async (mappings: GcsGcFormsFieldMapping[]) => {
  await db
    .insertInto('extensions.gcs_gcforms_field_mappings')
    .values(mappings.map((mapping, index) => ({
      id: String(1000 + index),
      integration_id: '601',
      mapping_key: mapping.id,
      source_question_id: mapping.sourceQuestionId,
      destination_entity: mapping.destinationEntity,
      destination_path: mapping.destinationPath,
      transform: mapping.transform,
      required: mapping.required,
      default_value: mapping.defaultValue === undefined ? null : mapping.defaultValue,
      on_missing: mapping.onMissing,
      on_invalid: mapping.onInvalid
    })))
    .execute()
}

const materialize = async (
  mappings: GcsGcFormsFieldMapping[],
  mappedValues: GcsGcFormsMappedValue[],
  submissionId = '901',
  submissionUuid = '05-09-09f4',
  createAgreementClaim: NonNullable<NonNullable<Parameters<typeof materializeGcFormsClaimSubmission>[1]>['createAgreementClaim']> = async input => {
    const status = await db.selectFrom('Common_Status')
      .select(['id', 'egcs_cn_isdraft'])
      .where('id', '=', input.expectedDraftStatusId ?? '')
      .where('egcs_cn_agency', '=', '20')
      .where('_deleted', '=', false)
      .executeTakeFirst()
    if (!status) return { status: 'requested_status_unavailable' }
    if (!status.egcs_cn_isdraft) return { status: 'requested_status_not_draft' }
    const claim = await db.insertInto('Funding_Case_Agreement_Claim').values({
      egcs_fc_fundingagreement: input.agreementId,
      egcs_fc_fiscalyear: input.fiscalYearId,
      egcs_fc_isfinalforyear: input.isFinalForYear,
      egcs_fc_periodstart: input.periodStart,
      egcs_fc_periodend: input.periodEnd,
      egcs_fc_receiveddate: input.receivedDate,
      egcs_fc_gcformssubmissionuuid: input.submissionUuid,
      egcs_fc_status: String(status.id)
    }).returning('id').executeTakeFirstOrThrow()
    const lineItemIds: string[] = []
    for (const lineItem of input.lineItems) {
      const created = await db.insertInto('Funding_Case_Agreement_Claim_Line_Item').values({
        egcs_fc_fundingagreementclaim: String(claim.id),
        egcs_fc_fundingagreementbudgetlineitem: lineItem.budgetLineItemId,
        egcs_fc_submittedcostcategory: lineItem.submittedCostCategory,
        egcs_fc_submittedcostsubsection: lineItem.submittedCostSubsection,
        egcs_fc_submittedlineitem: lineItem.submittedLineItem,
        egcs_fc_description: lineItem.description,
        egcs_fc_amount: lineItem.amount,
        egcs_fc_currency: lineItem.currency
      }).returning('id').executeTakeFirstOrThrow()
      lineItemIds.push(String(created.id))
    }
    return { status: 'created', claimId: String(claim.id), lineItemIds, draftStatusId: String(status.id) }
  },
  submissionStatusId = '91',
  agencyId = '20'
) => await materializeGcFormsClaimSubmission(db, {
  agencyId,
  streamId: '31',
  integrationId: '601',
  submissionId,
  submissionUuid,
  submissionStatusId,
  mappings,
  mappedValues,
  createAgreementClaim
})

beforeEach(async () => {
  const pglite = await KyselyPGlite.create(`memory://gcforms-claim-materialization-${Date.now()}`)
  db = new Kysely<GcFormsIntegrationHostDatabase>({ dialect: pglite.dialect })
  await createSchema()
  await seedBaseData()
})

afterEach(async () => {
  await db.destroy()
})

describe('GC Forms claim materialization', () => {
  it('fails materialization when configured mappings target unsupported destinations', async () => {
    const result = await materialize([
      {
        id: 'source-only',
        sourceQuestionId: 'payload',
        destinationEntity: 'source_record',
        destinationPath: 'payload',
        transform: 'json',
        required: false,
        onMissing: 'skip',
        onInvalid: 'block'
      }
    ], [])

    expect(result).toEqual({
      status: 'failed',
      lineItemIds: [],
      issues: [{
        mappingId: 'source-only',
        sourceQuestionId: 'payload',
        destinationPath: 'payload',
        code: 'unsupported_destination',
        params: {
          destinationEntity: 'source_record',
          destinationPath: 'payload'
        }
      }]
    })
    await expect(db.selectFrom('Funding_Case_Agreement_Claim').selectAll().execute()).resolves.toEqual([])
  })

  it('returns not applicable only when no mappings are configured', async () => {
    await expect(materialize([], [])).resolves.toEqual({
      status: 'not_applicable',
      lineItemIds: [],
      issues: []
    })
  })

  it('reports unsupported destinations before an existing destination-link short circuit', async () => {
    await seedMappings(claimMappings)
    await materialize(claimMappings, claimValues)

    const result = await materialize([{
      id: 'unsupported-existing',
      sourceQuestionId: 'payload',
      destinationEntity: 'source_record',
      destinationPath: 'payload',
      transform: 'json',
      required: false,
      onMissing: 'skip',
      onInvalid: 'block'
    }], [], '901', '05-09-09f4')

    expect(result).toEqual({
      status: 'failed',
      lineItemIds: [],
      issues: [expect.objectContaining({
        mappingId: 'unsupported-existing',
        code: 'unsupported_destination'
      })]
    })
  })

  it('creates a claim with the configured Agency status and destination link for claim mappings', async () => {
    await seedMappings(claimMappings)

    const result = await materialize(claimMappings, claimValues)

    expect(result).toEqual(expect.objectContaining({
      status: 'created',
      claimId: '1',
      lineItemIds: []
    }))
    const claim = await db
      .selectFrom('Funding_Case_Agreement_Claim')
      .selectAll()
      .executeTakeFirstOrThrow()
    expect(claim).toEqual(expect.objectContaining({
      egcs_fc_fundingagreement: 101,
      egcs_fc_fiscalyear: 501,
      egcs_fc_status: '91',
      egcs_fc_isfinalforyear: false,
      egcs_fc_periodstart: 0,
      egcs_fc_periodend: 2,
      egcs_fc_gcformssubmissionuuid: '05-09-09f4'
    }))

    const link = await db
      .selectFrom('extensions.gcs_gcforms_destination_links')
      .selectAll()
      .executeTakeFirstOrThrow()
    expect(link).toEqual(expect.objectContaining({
      submission_id: 901,
      owner_type: 'fundingcaseagreementclaim',
      owner_id: 1,
      destination_entity: 'claim'
    }))
  })

  it('delegates core Claim creation to the host and links only the returned identities', async () => {
    await seedMappings([...claimMappings, ...lineItemMappings])
    const createAgreementClaim = vi.fn(async () => ({
      status: 'created' as const,
      claimId: '501',
      lineItemIds: ['701'],
      draftStatusId: '91'
    }))

    const result = await materialize(
      [...claimMappings, ...lineItemMappings],
      [...claimValues, ...lineItemValues],
      '901',
      '05-09-09f4',
      createAgreementClaim
    )

    expect(createAgreementClaim).toHaveBeenCalledWith(expect.objectContaining({
      agreementId: '101',
      streamId: '31',
      fiscalYearId: '501',
      expectedDraftStatusId: '91',
      submissionUuid: '05-09-09f4',
      lineItems: [expect.objectContaining({
        budgetLineItemId: '701',
        amount: '1234.56',
        currency: 'cad'
      })]
    }))
    expect(result).toEqual({ status: 'created', claimId: '501', lineItemIds: ['701'], issues: [] })
    await expect(db.selectFrom('Funding_Case_Agreement_Claim').selectAll().execute()).resolves.toEqual([])
    await expect(db.selectFrom('Funding_Case_Agreement_Claim_Line_Item').selectAll().execute()).resolves.toEqual([])
    const links = await db.selectFrom('extensions.gcs_gcforms_destination_links')
      .select(['owner_type', 'owner_id'])
      .orderBy('id')
      .execute()
    expect(links).toEqual([
      { owner_type: 'fundingcaseagreementclaim', owner_id: 501 },
      { owner_type: 'fundingcaseagreementclaimlineitem', owner_id: 701 }
    ])
  })

  it.each([
    { label: 'missing', lineItemIds: [] },
    { label: 'extra', lineItemIds: ['701', '702'] }
  ])('rejects a $label host line-item identity before writing links', async ({ lineItemIds }) => {
    await seedMappings([...claimMappings, ...lineItemMappings])

    await expect(materialize(
      [...claimMappings, ...lineItemMappings],
      [...claimValues, ...lineItemValues],
      '901',
      '05-09-09f4',
      async () => ({ status: 'created', claimId: '501', lineItemIds, draftStatusId: '91' })
    )).rejects.toThrow('invalid line-item identity list')
    await expect(db.selectFrom('extensions.gcs_gcforms_destination_links').selectAll().execute()).resolves.toEqual([])
  })

  it.each([
    ['another Agency', '92'],
    ['a deleted status', '93']
  ])('rejects materialization when the configured status belongs to %s', async (_label, statusId) => {
    await seedMappings(claimMappings)

    await expect(materialize(
      claimMappings,
      claimValues,
      '901',
      '05-09-09f4',
      undefined,
      statusId
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'GCS_GCFORMS_SUBMISSION_STATUS_UNAVAILABLE'
    })
    await expect(db.selectFrom('Funding_Case_Agreement_Claim').selectAll().execute()).resolves.toEqual([])
  })

  it('rejects materialization when the configured live Agency status is not Draft', async () => {
    await db.insertInto('Common_Status').values({ id: '94', egcs_cn_agency: '20' }).execute()
    await seedMappings(claimMappings)

    await expect(materialize(
      claimMappings,
      claimValues,
      '901',
      '05-09-09f4',
      undefined,
      '94'
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'GCS_GCFORMS_SUBMISSION_STATUS_NOT_DRAFT',
      localizedMessage: {
        en: expect.stringContaining('Draft'),
        fr: expect.stringContaining('Brouillon')
      }
    })
    await expect(db.selectFrom('Funding_Case_Agreement_Claim').selectAll().execute()).resolves.toEqual([])
  })

  it('leaves agreement-owned tables unchanged when agreement authorization is denied', async () => {
    await seedMappings(claimMappings)
    const authorizationDenied = new Error('agreement update denied')

    await expect(materialize(
      claimMappings,
      claimValues,
      '901',
      '05-09-09f4',
      async () => { throw authorizationDenied }
    )).rejects.toBe(authorizationDenied)

    await expect(db.selectFrom('Funding_Case_Agreement_Claim').selectAll().execute()).resolves.toEqual([])
    await expect(db.selectFrom('extensions.gcs_gcforms_destination_links').selectAll().execute()).resolves.toEqual([])
  })

  it('defaults final for year to false when no source field is mapped', async () => {
    const mappingsWithoutFinalForYear = claimMappings.filter(mapping => mapping.destinationPath !== 'egcs_fc_isfinalforyear')
    const valuesWithoutFinalForYear = claimValues.filter(value => value.destinationPath !== 'egcs_fc_isfinalforyear')
    await seedMappings(mappingsWithoutFinalForYear)

    const result = await materialize(mappingsWithoutFinalForYear, valuesWithoutFinalForYear)

    expect(result.status).toBe('created')
    const claim = await db
      .selectFrom('Funding_Case_Agreement_Claim')
      .select(['egcs_fc_isfinalforyear'])
      .executeTakeFirstOrThrow()
    expect(claim.egcs_fc_isfinalforyear).toBe(false)
  })

  it('resolves the agreement number only within the configured stream', async () => {
    await seedMappings(claimMappings)

    const result = await materialize(claimMappings, claimValues.map(value =>
      value.destinationPath === 'egcs_fc_fiscalyear'
        ? { ...value, value: '502' }
        : value
    ))

    expect(result.status).toBe('failed')
    expect(result.issues).toEqual([
      expect.objectContaining({
        destinationPath: 'claim.egcs_fc_fiscalyear',
        code: 'claim_fiscal_year_invalid'
      })
    ])
    await expect(db.selectFrom('Funding_Case_Agreement_Claim').selectAll().execute()).resolves.toEqual([])
  })

  it('reports missing host-required claim fields without creating a claim', async () => {
    await seedMappings(claimMappings)

    const result = await materialize(
      claimMappings,
      claimValues.filter(value => value.destinationPath !== 'egcs_fc_receiveddate')
    )

    expect(result.status).toBe('failed')
    expect(result.issues).toEqual([
      expect.objectContaining({
        destinationPath: 'claim.egcs_fc_receiveddate',
        code: 'claim_required_value_missing'
      })
    ])
    await expect(db.selectFrom('Funding_Case_Agreement_Claim').selectAll().execute()).resolves.toEqual([])
  })

  it('uses a manual agreement override when GC Forms agreement number does not match the stream', async () => {
    await seedMappings(claimMappings)
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

    const result = await materialize(claimMappings, claimValues.map(value =>
      value.destinationPath === 'egcs_fc_fundingagreement'
        ? { ...value, value: 'AGR-MISSING' }
        : value
    ))

    expect(result).toEqual(expect.objectContaining({
      status: 'created',
      claimId: '1'
    }))
    const claim = await db
      .selectFrom('Funding_Case_Agreement_Claim')
      .selectAll()
      .executeTakeFirstOrThrow()
    expect(claim.egcs_fc_fundingagreement).toBe(101)
  })

  it('accepts fiscal year display labels and fiscal-year month labels', async () => {
    await seedMappings(claimMappings)

    const result = await materialize(claimMappings, claimValues.map(value => {
      if (value.destinationPath === 'egcs_fc_fiscalyear') {
        return { ...value, value: '2025-2026' }
      }
      if (value.destinationPath === 'egcs_fc_periodstart') {
        return { ...value, value: 'April' }
      }
      if (value.destinationPath === 'egcs_fc_periodend') {
        return { ...value, value: 'June' }
      }

      return value
    }))

    expect(result.status).toBe('created')
    const claim = await db
      .selectFrom('Funding_Case_Agreement_Claim')
      .selectAll()
      .executeTakeFirstOrThrow()
    expect(claim).toEqual(expect.objectContaining({
      egcs_fc_fiscalyear: 501,
      egcs_fc_periodstart: 0,
      egcs_fc_periodend: 2
    }))
  })

  it('does not create duplicate claims or links for a rerun of the same submission', async () => {
    await seedMappings(claimMappings)

    const first = await materialize(claimMappings, claimValues)
    const second = await materialize(claimMappings, claimValues)

    expect(first.status).toBe('created')
    expect(second).toEqual(expect.objectContaining({
      status: 'already_materialized',
      claimId: '1'
    }))
    await expect(db.selectFrom('Funding_Case_Agreement_Claim').selectAll().execute()).resolves.toHaveLength(1)
    await expect(db.selectFrom('extensions.gcs_gcforms_destination_links').selectAll().execute()).resolves.toHaveLength(1)
  })

  it('skips materialization when the host claim already tracks the GC Forms submission UUID', async () => {
    await seedMappings(claimMappings)

    const first = await materialize(claimMappings, claimValues)
    const second = await materialize(claimMappings, claimValues, '902', '05-09-09f4')

    expect(first.status).toBe('created')
    expect(second).toEqual(expect.objectContaining({
      status: 'already_materialized',
      claimId: '1'
    }))
    await expect(db.selectFrom('Funding_Case_Agreement_Claim').selectAll().execute()).resolves.toHaveLength(1)
  })

  it('creates claim line items with valid budget links when available', async () => {
    await seedMappings([...claimMappings, ...lineItemMappings])

    const result = await materialize([...claimMappings, ...lineItemMappings], [...claimValues, ...lineItemValues])

    expect(result).toEqual(expect.objectContaining({
      status: 'created',
      claimId: '1',
      lineItemIds: ['1']
    }))
    const lineItem = await db
      .selectFrom('Funding_Case_Agreement_Claim_Line_Item')
      .selectAll()
      .executeTakeFirstOrThrow()
    expect(lineItem).toEqual(expect.objectContaining({
      egcs_fc_fundingagreementclaim: 1,
      egcs_fc_fundingagreementbudgetlineitem: 701,
      egcs_fc_submittedcostcategory: 'Operating Costs',
      egcs_fc_submittedcostsubsection: 'Delivery',
      egcs_fc_submittedlineitem: 'Travel',
      egcs_fc_description: 'Operating Costs / Delivery / Travel',
      egcs_fc_currency: 'cad'
    }))
    expect(lineItem.egcs_fc_amount).toBe('1234.56')
    const lineEvidence = await db
      .selectFrom('extensions.gcs_gcforms_destination_links')
      .select('value')
      .where('owner_type', '=', 'fundingcaseagreementclaimlineitem')
      .executeTakeFirstOrThrow()
    expect(lineEvidence.value).toEqual(expect.objectContaining({ amount: '1234.56' }))
  })

  it('emits full-range canonical money to the host hook', async () => {
    await seedMappings([...claimMappings, ...lineItemMappings])
    const createAgreementClaim = vi.fn(async () => ({
      status: 'created' as const,
      claimId: '501',
      lineItemIds: ['701'],
      draftStatusId: '91'
    }))
    const maxValues = lineItemValues.map(value => value.destinationPath === 'egcs_fc_amount'
      ? { ...value, value: '99,999,999,999,999,999.99' }
      : value)

    await materialize(
      [...claimMappings, ...lineItemMappings],
      [...claimValues, ...maxValues],
      '901',
      '05-09-09f4',
      createAgreementClaim
    )

    expect(createAgreementClaim).toHaveBeenCalledWith(expect.objectContaining({
      lineItems: [expect.objectContaining({ amount: '99999999999999999.99' })]
    }))
  })

  it.each(['1e2', '1.234', '100000000000000000.00'])(
    'rejects invalid exact money %s before calling the host hook',
    async amount => {
      await seedMappings([...claimMappings, ...lineItemMappings])
      const createAgreementClaim = vi.fn()
      const invalidValues = lineItemValues.map(value => value.destinationPath === 'egcs_fc_amount'
        ? { ...value, value: amount }
        : value)

      const result = await materialize(
        [...claimMappings, ...lineItemMappings],
        [...claimValues, ...invalidValues],
        '901',
        '05-09-09f4',
        createAgreementClaim
      )

      expect(result).toEqual(expect.objectContaining({
        status: 'failed',
        issues: [expect.objectContaining({ code: 'claim_line_item_values_invalid' })]
      }))
      expect(createAgreementClaim).not.toHaveBeenCalled()
    }
  )

  it('creates multiple claim line items from repeated GC Forms line item answers', async () => {
    await seedMappings([...claimMappings, ...lineItemMappings])

    const result = await materialize([...claimMappings, ...lineItemMappings], [
      ...claimValues,
      {
        mappingId: 'submitted-category',
        sourceQuestionId: 'submitted_cost_category',
        destinationEntity: 'claim_line_item',
        destinationPath: 'egcs_fc_submittedcostcategory',
        value: ['Operating Costs', 'Operating Costs']
      },
      {
        mappingId: 'submitted-subsection',
        sourceQuestionId: 'submitted_cost_subsection',
        destinationEntity: 'claim_line_item',
        destinationPath: 'egcs_fc_submittedcostsubsection',
        value: ['Delivery', 'Administration']
      },
      {
        mappingId: 'submitted-line-item',
        sourceQuestionId: 'submitted_line_item',
        destinationEntity: 'claim_line_item',
        destinationPath: 'egcs_fc_submittedlineitem',
        value: ['Travel', 'Equipment']
      },
      {
        mappingId: 'line-amount',
        sourceQuestionId: 'submitted_amount',
        destinationEntity: 'claim_line_item',
        destinationPath: 'egcs_fc_amount',
        value: [75, 30]
      }
    ])

    expect(result).toEqual(expect.objectContaining({
      status: 'created',
      claimId: '1',
      lineItemIds: ['1', '2']
    }))
    const lineItems = await db
      .selectFrom('Funding_Case_Agreement_Claim_Line_Item')
      .select([
        'egcs_fc_fundingagreementbudgetlineitem as budgetLineItem',
        'egcs_fc_submittedcostsubsection as subsection',
        'egcs_fc_submittedlineitem as lineItem',
        'egcs_fc_amount as amount'
      ])
      .orderBy('id', 'asc')
      .execute()
    expect(lineItems).toEqual([
      expect.objectContaining({
        budgetLineItem: 701,
        subsection: 'Delivery',
        lineItem: 'Travel'
      }),
      expect.objectContaining({
        budgetLineItem: null,
        subsection: 'Administration',
        lineItem: 'Equipment'
      })
    ])
    expect(lineItems.map(item => Number(item.amount))).toEqual([75, 30])
  })

  it('preserves raw submitted claim line hierarchy and leaves invalid budget links unallocated', async () => {
    await seedSubmission('902', 'submission-2')
    await seedMappings([...claimMappings, ...lineItemMappings])

    const result = await materialize(
      [...claimMappings, ...lineItemMappings],
      [
        ...claimValues,
        ...lineItemValues.map(value =>
          value.destinationPath === 'egcs_fc_fundingagreementbudgetlineitem'
            ? { ...value, value: '702' }
            : value.destinationPath === 'egcs_fc_submittedcostcategory'
              ? { ...value, value: 'Submitted category' }
              : value.destinationPath === 'egcs_fc_submittedcostsubsection'
                ? { ...value, value: 'Submitted subsection' }
                : value.destinationPath === 'egcs_fc_submittedlineitem'
                  ? { ...value, value: 'Submitted line' }
                  : value
        )
      ],
      '902'
    )

    expect(result).toEqual(expect.objectContaining({
      status: 'created',
      claimId: '1',
      lineItemIds: ['1']
    }))
    const lineItem = await db
      .selectFrom('Funding_Case_Agreement_Claim_Line_Item')
      .selectAll()
      .executeTakeFirstOrThrow()
    expect(lineItem).toEqual(expect.objectContaining({
      egcs_fc_fundingagreementbudgetlineitem: null,
      egcs_fc_submittedcostcategory: 'Submitted category',
      egcs_fc_submittedcostsubsection: 'Submitted subsection',
      egcs_fc_submittedlineitem: 'Submitted line'
    }))
  })

  it('accepts entity-prefixed destination paths and string-coerced booleans', async () => {
    const prefixedMappings = claimMappings.map(withDestinationPathPrefix)
    const prefixedValues = claimValues.map(value => {
      if (value.destinationPath === 'egcs_fc_isfinalforyear') {
        return withMappedDestinationPathPrefix({ ...value, value: 'no' })
      }

      if (value.destinationPath === 'egcs_fc_periodstart' || value.destinationPath === 'egcs_fc_periodend') {
        return withMappedDestinationPathPrefix({ ...value, value: String(value.value) })
      }

      return withMappedDestinationPathPrefix(value)
    })

    const result = await materialize(prefixedMappings, prefixedValues)

    expect(result.status).toBe('created')
    const link = await db
      .selectFrom('extensions.gcs_gcforms_destination_links')
      .selectAll()
      .executeTakeFirstOrThrow()
    expect(link.mapping_id).toBeNull()
  })

  it('accepts host table-prefixed destination paths for claims and line items', async () => {
    await seedSubmission('902', 'submission-2')
    const tablePrefixedMappings = [...claimMappings, ...lineItemMappings].map(withTableDestinationPathPrefix)
    const tablePrefixedValues = [...claimValues, ...lineItemValues].map(withMappedTableDestinationPathPrefix)
    await seedMappings(tablePrefixedMappings)

    const result = await materialize(tablePrefixedMappings, tablePrefixedValues, '902')

    expect(result).toEqual(expect.objectContaining({
      status: 'created',
      claimId: '1',
      lineItemIds: ['1']
    }))
  })

  it('creates only a claim when line-item mappings exist but no line-item values are present', async () => {
    await seedMappings([...claimMappings, ...lineItemMappings])

    const result = await materialize([...claimMappings, ...lineItemMappings], claimValues)

    expect(result).toEqual(expect.objectContaining({
      status: 'created',
      claimId: '1',
      lineItemIds: []
    }))
    await expect(db.selectFrom('Funding_Case_Agreement_Claim_Line_Item').selectAll().execute()).resolves.toEqual([])
  })

  it('reports incomplete claim line-item values before creating a claim', async () => {
    await seedMappings([...claimMappings, ...lineItemMappings])

    const result = await materialize(
      [...claimMappings, ...lineItemMappings],
      [
        ...claimValues,
        ...lineItemValues.filter(value => value.destinationPath !== 'egcs_fc_submittedlineitem')
      ]
    )

    expect(result.status).toBe('failed')
    expect(result.issues).toEqual([
      expect.objectContaining({
        destinationPath: 'claim_line_item.egcs_fc_submittedlineitem',
        code: 'claim_line_item_required_value_missing'
      })
    ])
    await expect(db.selectFrom('Funding_Case_Agreement_Claim').selectAll().execute()).resolves.toEqual([])
  })

  it('reports invalid claim values before creating a claim', async () => {
    await seedMappings(claimMappings)

    const invalidBoolean = await materialize(claimMappings, claimValues.map(value =>
      value.destinationPath === 'egcs_fc_isfinalforyear'
        ? { ...value, value: 'maybe' }
        : value
    ))
    const invalidDate = await materialize(claimMappings, claimValues.map(value =>
      value.destinationPath === 'egcs_fc_receiveddate'
        ? { ...value, value: 'not-a-date' }
        : value
    ))
    const invalidPeriod = await materialize(claimMappings, claimValues.map(value =>
      value.destinationPath === 'egcs_fc_periodend'
        ? { ...value, value: -1 }
        : value
    ))
    const missingAgreement = await materialize(claimMappings, claimValues.map(value =>
      value.destinationPath === 'egcs_fc_fundingagreement'
        ? { ...value, value: 'AGR-MISSING' }
        : value
    ))

    expect(invalidBoolean.status).toBe('failed')
    expect(invalidDate.status).toBe('failed')
    expect(invalidPeriod).toEqual(expect.objectContaining({
      status: 'failed',
      issues: [expect.objectContaining({ destinationPath: 'claim.egcs_fc_periodend' })]
    }))
    expect(missingAgreement).toEqual(expect.objectContaining({
      status: 'failed',
      issues: [expect.objectContaining({ destinationPath: 'claim.egcs_fc_fundingagreement' })]
    }))
    await expect(db.selectFrom('Funding_Case_Agreement_Claim').selectAll().execute()).resolves.toEqual([])
  })
})
