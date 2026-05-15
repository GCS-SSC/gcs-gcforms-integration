/* eslint-disable jsdoc/require-jsdoc */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
    required: true,
    onMissing: 'block',
    onInvalid: 'block'
  },
  {
    id: 'line-description',
    sourceQuestionId: 'line_description',
    destinationEntity: 'claim_line_item',
    destinationPath: 'egcs_fc_description',
    transform: 'string',
    required: true,
    onMissing: 'block',
    onInvalid: 'block'
  },
  {
    id: 'line-amount',
    sourceQuestionId: 'line_amount',
    destinationEntity: 'claim_line_item',
    destinationPath: 'egcs_fc_amount',
    transform: 'money',
    required: true,
    onMissing: 'block',
    onInvalid: 'block'
  },
  {
    id: 'line-currency',
    sourceQuestionId: 'line_currency',
    destinationEntity: 'claim_line_item',
    destinationPath: 'egcs_fc_currency',
    transform: 'string',
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
    mappingId: 'line-description',
    sourceQuestionId: 'line_description',
    destinationEntity: 'claim_line_item',
    destinationPath: 'egcs_fc_description',
    value: 'Training supplies'
  },
  {
    mappingId: 'line-amount',
    sourceQuestionId: 'line_amount',
    destinationEntity: 'claim_line_item',
    destinationPath: 'egcs_fc_amount',
    value: 1234.56
  },
  {
    mappingId: 'line-currency',
    sourceQuestionId: 'line_currency',
    destinationEntity: 'claim_line_item',
    destinationPath: 'egcs_fc_currency',
    value: 'CAD'
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
    CREATE TABLE "Funding_Case_Agreement_Profile" (
      id bigserial PRIMARY KEY,
      egcs_fc_agreementnumber varchar(15) NOT NULL,
      egcs_fc_transferpaymentstream bigint NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE "Funding_Case_Agreement_Budget_Fiscal_Year" (
      id bigserial PRIMARY KEY,
      egcs_fc_fundingagreement bigint NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE "Funding_Case_Agreement_Budget_Line_Item" (
      id bigserial PRIMARY KEY,
      egcs_fc_fundingagreementbudgetfiscalyear bigint NOT NULL,
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
      egcs_fc_status varchar(40) NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE "Funding_Case_Agreement_Claim_Line_Item" (
      id bigserial PRIMARY KEY,
      egcs_fc_fundingagreementclaim bigint NOT NULL,
      egcs_fc_fundingagreementbudgetlineitem bigint NOT NULL,
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
      last_error text,
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
}

const seedBaseData = async () => {
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
    .insertInto('Funding_Case_Agreement_Budget_Fiscal_Year')
    .values([
      {
        id: '501',
        egcs_fc_fundingagreement: '101'
      },
      {
        id: '502',
        egcs_fc_fundingagreement: '102'
      }
    ])
    .execute()
  await db
    .insertInto('Funding_Case_Agreement_Budget_Line_Item')
    .values([
      {
        id: '701',
        egcs_fc_fundingagreementbudgetfiscalyear: '501'
      },
      {
        id: '702',
        egcs_fc_fundingagreementbudgetfiscalyear: '502'
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
  submissionId = '901'
) => await materializeGcFormsClaimSubmission(db, {
  streamId: '31',
  integrationId: '601',
  submissionId,
  mappings,
  mappedValues
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
  it('skips materialization when no claim-related mappings are configured', async () => {
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
      status: 'not_applicable',
      lineItemIds: [],
      issues: []
    })
    await expect(db.selectFrom('Funding_Case_Agreement_Claim').selectAll().execute()).resolves.toEqual([])
  })

  it('creates a draft claim and destination link for claim mappings', async () => {
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
      egcs_fc_status: 'draft',
      egcs_fc_isfinalforyear: false,
      egcs_fc_periodstart: 0,
      egcs_fc_periodend: 2
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
        code: 'invalid_value'
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
        code: 'missing_required_value'
      })
    ])
    await expect(db.selectFrom('Funding_Case_Agreement_Claim').selectAll().execute()).resolves.toEqual([])
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

  it('creates claim line items only when the budget line item is valid for the claim fiscal year', async () => {
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
      egcs_fc_description: 'Training supplies',
      egcs_fc_currency: 'CAD'
    }))
    expect(Number(lineItem.egcs_fc_amount)).toBe(1234.56)

    await seedSubmission('902', 'submission-2')

    const invalid = await materialize(
      [...claimMappings, ...lineItemMappings],
      [
        ...claimValues,
        ...lineItemValues.map(value =>
          value.destinationPath === 'egcs_fc_fundingagreementbudgetlineitem'
            ? { ...value, value: '702' }
            : value
        )
      ],
      '902'
    )

    expect(invalid.status).toBe('failed')
    expect(invalid.issues).toEqual([
      expect.objectContaining({
        destinationPath: 'claim_line_item.egcs_fc_fundingagreementbudgetlineitem',
        code: 'invalid_value'
      })
    ])
    await expect(db.selectFrom('Funding_Case_Agreement_Claim').selectAll().execute()).resolves.toHaveLength(1)
    await expect(db.selectFrom('Funding_Case_Agreement_Claim_Line_Item').selectAll().execute()).resolves.toHaveLength(1)
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
        ...lineItemValues.filter(value => value.destinationPath !== 'egcs_fc_currency')
      ]
    )

    expect(result.status).toBe('failed')
    expect(result.issues).toEqual([
      expect.objectContaining({
        destinationPath: 'claim_line_item.egcs_fc_currency',
        code: 'missing_required_value'
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
