import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import type { GcFormsIntegrationHostDatabase } from '../../server/db'
import { generateGcFormsClaimTemplate } from '../../server/claim-template'

type TestDb = Kysely<GcFormsIntegrationHostDatabase>

type TemplateElement = {
  type?: string
  properties?: {
    questionId?: string
    choices?: Array<{ en: string; fr: string }>
    subElements?: TemplateElement[]
    validation?: {
      required?: boolean
    }
    [key: string]: unknown
  }
  elements?: TemplateElement[]
  [key: string]: unknown
}

let db: TestDb

const createSchema = async () => {
  await sql`
    CREATE TABLE "Funding_Case_Agreement_Profile" (
      id bigserial PRIMARY KEY,
      egcs_fc_agreementnumber varchar(120) NOT NULL,
      egcs_fc_transferpaymentstream bigint NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE "Agency_Fiscal_Year" (
      id bigserial PRIMARY KEY,
      egcs_ay_fiscalyeardisplay varchar(40) NOT NULL,
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
      egcs_ay_name_en varchar(200) NOT NULL,
      egcs_ay_name_fr varchar(200) NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
  await sql`
    CREATE TABLE "Agency_Cost_Category_Line_Item" (
      id bigserial PRIMARY KEY,
      egcs_ay_name_en varchar(200) NOT NULL,
      egcs_ay_name_fr varchar(200) NOT NULL,
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
      egcs_fc_description text DEFAULT '' NOT NULL,
      _deleted boolean DEFAULT false NOT NULL
    )
  `.execute(db)
}

const seedStreamBudgetData = async () => {
  await db.insertInto('Funding_Case_Agreement_Profile').values([
    { id: '101', egcs_fc_agreementnumber: 'A-001', egcs_fc_transferpaymentstream: '10', _deleted: false },
    { id: '102', egcs_fc_agreementnumber: 'A-002', egcs_fc_transferpaymentstream: '10', _deleted: true },
    { id: '103', egcs_fc_agreementnumber: 'A-003', egcs_fc_transferpaymentstream: '11', _deleted: false }
  ]).execute()
  await db.insertInto('Agency_Fiscal_Year').values([
    { id: '201', egcs_ay_fiscalyeardisplay: '2025-2026', _deleted: false },
    { id: '202', egcs_ay_fiscalyeardisplay: '2026-2027', _deleted: false },
    { id: '203', egcs_ay_fiscalyeardisplay: '2027-2028', _deleted: true },
    { id: '204', egcs_ay_fiscalyeardisplay: '2028-2029', _deleted: false }
  ]).execute()
  await db.insertInto('Funding_Case_Agreement_Budget_Fiscal_Year').values([
    { id: '301', egcs_fc_fundingagreement: '101', egcs_fc_fiscalyear: '201', _deleted: false },
    { id: '302', egcs_fc_fundingagreement: '101', egcs_fc_fiscalyear: '202', _deleted: false },
    { id: '303', egcs_fc_fundingagreement: '101', egcs_fc_fiscalyear: '203', _deleted: false },
    { id: '304', egcs_fc_fundingagreement: '102', egcs_fc_fiscalyear: '204', _deleted: false },
    { id: '305', egcs_fc_fundingagreement: '103', egcs_fc_fiscalyear: '204', _deleted: false },
    { id: '306', egcs_fc_fundingagreement: '101', egcs_fc_fiscalyear: '204', _deleted: true }
  ]).execute()
  await db.insertInto('Agency_Cost_Category').values([
    { id: '401', egcs_ay_name_en: 'Operating Costs', egcs_ay_name_fr: 'Couts de fonctionnement', _deleted: false },
    { id: '402', egcs_ay_name_en: 'Capital Costs', egcs_ay_name_fr: 'Couts en capital', _deleted: false },
    { id: '403', egcs_ay_name_en: 'Deleted Category', egcs_ay_name_fr: 'Categorie supprimee', _deleted: true }
  ]).execute()
  await db.insertInto('Agency_Cost_Category_Line_Item').values([
    { id: '501', egcs_ay_name_en: 'Equipment', egcs_ay_name_fr: 'Equipement', egcs_ay_organizationcostcategory: '401', _deleted: false },
    { id: '502', egcs_ay_name_en: 'Travel', egcs_ay_name_fr: 'Deplacement', egcs_ay_organizationcostcategory: '401', _deleted: false },
    { id: '503', egcs_ay_name_en: 'Renovation', egcs_ay_name_fr: 'Renovation', egcs_ay_organizationcostcategory: '402', _deleted: false },
    { id: '504', egcs_ay_name_en: 'Deleted Line Item', egcs_ay_name_fr: 'Ligne supprimee', egcs_ay_organizationcostcategory: '401', _deleted: true },
    { id: '505', egcs_ay_name_en: 'Deleted Category Line', egcs_ay_name_fr: 'Ligne categorie supprimee', egcs_ay_organizationcostcategory: '403', _deleted: false }
  ]).execute()
  await db.insertInto('Transfer_Payment_Stream_Cost_Category_Line_Item').values([
    { id: '601', egcs_tp_transferpaymentstream: '10', egcs_tp_organizationcostcategory: '501', _deleted: false },
    { id: '602', egcs_tp_transferpaymentstream: '10', egcs_tp_organizationcostcategory: '502', _deleted: false },
    { id: '603', egcs_tp_transferpaymentstream: '10', egcs_tp_organizationcostcategory: '503', _deleted: true },
    { id: '604', egcs_tp_transferpaymentstream: '11', egcs_tp_organizationcostcategory: '503', _deleted: false },
    { id: '605', egcs_tp_transferpaymentstream: '10', egcs_tp_organizationcostcategory: '504', _deleted: false },
    { id: '606', egcs_tp_transferpaymentstream: '10', egcs_tp_organizationcostcategory: '505', _deleted: false }
  ]).execute()
  await db.insertInto('Funding_Case_Agreement_Budget_Line_Item').values([
    { id: '701', egcs_fc_fundingagreementbudgetfiscalyear: '301', egcs_fc_organizationcostcategory: '601', egcs_fc_costsubsection: 'Delivery', egcs_fc_description: '', _deleted: false },
    { id: '702', egcs_fc_fundingagreementbudgetfiscalyear: '302', egcs_fc_organizationcostcategory: '602', egcs_fc_costsubsection: 'Administration', egcs_fc_description: '', _deleted: false },
    { id: '703', egcs_fc_fundingagreementbudgetfiscalyear: '301', egcs_fc_organizationcostcategory: '602', egcs_fc_costsubsection: 'Administration', egcs_fc_description: '', _deleted: true },
    { id: '704', egcs_fc_fundingagreementbudgetfiscalyear: '301', egcs_fc_organizationcostcategory: '603', egcs_fc_costsubsection: 'Deleted stream item', egcs_fc_description: '', _deleted: false },
    { id: '705', egcs_fc_fundingagreementbudgetfiscalyear: '301', egcs_fc_organizationcostcategory: '605', egcs_fc_costsubsection: 'Deleted agency line', egcs_fc_description: '', _deleted: false },
    { id: '706', egcs_fc_fundingagreementbudgetfiscalyear: '301', egcs_fc_organizationcostcategory: '606', egcs_fc_costsubsection: 'Deleted category', egcs_fc_description: '', _deleted: false },
    { id: '707', egcs_fc_fundingagreementbudgetfiscalyear: '304', egcs_fc_organizationcostcategory: '601', egcs_fc_costsubsection: 'Deleted agreement', egcs_fc_description: '', _deleted: false },
    { id: '708', egcs_fc_fundingagreementbudgetfiscalyear: '305', egcs_fc_organizationcostcategory: '604', egcs_fc_costsubsection: 'Other stream', egcs_fc_description: '', _deleted: false }
  ]).execute()
}

const findElementOrNull = (elements: TemplateElement[] | undefined, questionId: string): TemplateElement | null => {
  for (const element of elements ?? []) {
    if (element.properties?.questionId === questionId) {
      return element
    }

    if (element.elements) {
      const found = findElementOrNull(element.elements, questionId)
      if (found) {
        return found
      }
    }

    if (element.properties?.subElements) {
      const found = findElementOrNull(element.properties.subElements, questionId)
      if (found) {
        return found
      }
    }
  }

  return null
}

const findElement = (elements: TemplateElement[] | undefined, questionId: string): TemplateElement => {
  const found = findElementOrNull(elements, questionId)
  if (found) {
    return found
  }

  throw new Error(`Question not found: ${questionId}`)
}

describe('GC Forms claim template generator', () => {
  beforeEach(async () => {
    const pglite = await KyselyPGlite.create(`memory://gcforms-claim-template-${Date.now()}`)
    db = new Kysely<GcFormsIntegrationHostDatabase>({ dialect: pglite.dialect })
    await createSchema()
    await seedStreamBudgetData()
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('replaces stream-dependent dropdown choices and leaves unrelated fields intact', async () => {
    const template = await generateGcFormsClaimTemplate(db, '10')
    const fiscalYear = findElement(template.elements, 'fiscal_year')
    const costCategory = findElement(template.elements, 'submitted_cost_category')
    const lineItem = findElement(template.elements, 'submitted_line_item')
    const notes = findElement(template.elements, 'claim_notes')

    expect(fiscalYear.type).toBe('dropdown')
    expect(fiscalYear.properties?.choices).toEqual([
      { en: '', fr: '' },
      { en: '2025-2026', fr: '2025-2026' },
      { en: '2026-2027', fr: '2026-2027' }
    ])
    expect(costCategory.properties?.choices).toEqual([
      { en: '', fr: '' },
      { en: 'Operating Costs', fr: 'Couts de fonctionnement' }
    ])
    expect(lineItem.properties?.choices).toEqual([
      { en: '', fr: '' },
      { en: 'Equipment', fr: 'Equipement' },
      { en: 'Travel', fr: 'Deplacement' }
    ])
    expect(notes.type).toBe('textArea')
    expect(notes.properties?.validation?.required).toBe(false)
  })

  it('converts submitted cost subsection to a required text field without generated dropdown values', async () => {
    const template = await generateGcFormsClaimTemplate(db, '10')
    const subsection = findElement(template.elements, 'submitted_cost_subsection')

    expect(subsection.type).toBe('textField')
    expect(subsection.properties?.choices).toEqual([{ en: '', fr: '' }])
    expect(subsection.properties?.validation?.required).toBe(true)
  })
})
