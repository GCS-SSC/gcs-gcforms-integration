import { readFile } from 'node:fs/promises'
import { sql } from 'kysely'
import { asGcFormsIntegrationDb } from './db'

type BilingualChoice = {
  en: string
  fr: string
}

type GcFormsTemplateElement = {
  type?: string
  properties?: {
    questionId?: string
    choices?: BilingualChoice[]
    subElements?: GcFormsTemplateElement[]
    validation?: {
      required?: boolean
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  elements?: GcFormsTemplateElement[]
  [key: string]: unknown
}

type GcFormsClaimTemplate = {
  elements?: GcFormsTemplateElement[]
  [key: string]: unknown
}

const CLAIM_TEMPLATE_URL = new URL('../gcs-claim-submission-integration-test-2026-05-19.json', import.meta.url)
const BLANK_CHOICE: BilingualChoice = { en: '', fr: '' }

const distinctBilingualChoices = (values: BilingualChoice[]): BilingualChoice[] => {
  const seen = new Set<string>()

  return values.filter(value => {
    const en = value.en.trim()
    const fr = value.fr.trim()
    if (!en && !fr) {
      return false
    }

    const key = `${en.toLocaleLowerCase('en-CA')}\u0000${fr.toLocaleLowerCase('fr-CA')}`
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

const choicesWithBlank = (values: BilingualChoice[]): BilingualChoice[] => [
  BLANK_CHOICE,
  ...distinctBilingualChoices(values)
]

const loadBaseClaimTemplate = async (): Promise<GcFormsClaimTemplate> => {
  const source = await readFile(CLAIM_TEMPLATE_URL, 'utf8')
  return JSON.parse(source) as GcFormsClaimTemplate
}

/** Loads the distinct fiscal-year labels used by agreements in a transfer-payment stream. */
const fetchFiscalYearChoices = async (rawDb: unknown, streamId: string): Promise<BilingualChoice[]> => {
  const db = asGcFormsIntegrationDb(rawDb)
  const rows = await db
    .selectFrom('Funding_Case_Agreement_Budget_Fiscal_Year')
    .innerJoin(
      'Funding_Case_Agreement_Profile',
      'Funding_Case_Agreement_Profile.id',
      'Funding_Case_Agreement_Budget_Fiscal_Year.egcs_fc_fundingagreement'
    )
    .innerJoin(
      'Agency_Fiscal_Year',
      'Agency_Fiscal_Year.id',
      'Funding_Case_Agreement_Budget_Fiscal_Year.egcs_fc_fiscalyear'
    )
    .select('Agency_Fiscal_Year.egcs_ay_fiscalyeardisplay as label')
    .where('Funding_Case_Agreement_Profile.egcs_fc_transferpaymentstream', '=', streamId)
    .where('Funding_Case_Agreement_Profile._deleted', '=', false)
    .where('Funding_Case_Agreement_Budget_Fiscal_Year._deleted', '=', false)
    .where('Agency_Fiscal_Year._deleted', '=', false)
    .groupBy('Agency_Fiscal_Year.egcs_ay_fiscalyeardisplay')
    .orderBy('Agency_Fiscal_Year.egcs_ay_fiscalyeardisplay', 'asc')
    .execute()

  return rows.map(row => ({ en: row.label, fr: row.label }))
}

/** Loads distinct bilingual cost-category and line-item choices available to a stream. */
const fetchBudgetLineItemChoices = async (rawDb: unknown, streamId: string) => {
  const db = asGcFormsIntegrationDb(rawDb)
  const rows = await db
    .selectFrom('Funding_Case_Agreement_Budget_Line_Item')
    .innerJoin(
      'Funding_Case_Agreement_Budget_Fiscal_Year',
      'Funding_Case_Agreement_Budget_Fiscal_Year.id',
      'Funding_Case_Agreement_Budget_Line_Item.egcs_fc_fundingagreementbudgetfiscalyear'
    )
    .innerJoin(
      'Funding_Case_Agreement_Profile',
      'Funding_Case_Agreement_Profile.id',
      'Funding_Case_Agreement_Budget_Fiscal_Year.egcs_fc_fundingagreement'
    )
    .innerJoin(
      'Transfer_Payment_Stream_Cost_Category_Line_Item',
      'Transfer_Payment_Stream_Cost_Category_Line_Item.id',
      'Funding_Case_Agreement_Budget_Line_Item.egcs_fc_organizationcostcategory'
    )
    .innerJoin(
      'Agency_Cost_Category_Line_Item',
      'Agency_Cost_Category_Line_Item.id',
      'Transfer_Payment_Stream_Cost_Category_Line_Item.egcs_tp_organizationcostcategory'
    )
    .innerJoin(
      'Agency_Cost_Category',
      'Agency_Cost_Category.id',
      'Agency_Cost_Category_Line_Item.egcs_ay_organizationcostcategory'
    )
    .select([
      'Agency_Cost_Category.egcs_ay_name_en as costCategoryEn',
      'Agency_Cost_Category.egcs_ay_name_fr as costCategoryFr',
      'Agency_Cost_Category_Line_Item.egcs_ay_name_en as lineItemEn',
      'Agency_Cost_Category_Line_Item.egcs_ay_name_fr as lineItemFr'
    ])
    .where('Funding_Case_Agreement_Profile.egcs_fc_transferpaymentstream', '=', streamId)
    .where('Funding_Case_Agreement_Profile._deleted', '=', false)
    .where('Funding_Case_Agreement_Budget_Fiscal_Year._deleted', '=', false)
    .where('Funding_Case_Agreement_Budget_Line_Item._deleted', '=', false)
    .where('Transfer_Payment_Stream_Cost_Category_Line_Item.egcs_tp_transferpaymentstream', '=', streamId)
    .where('Transfer_Payment_Stream_Cost_Category_Line_Item._deleted', '=', false)
    .where('Agency_Cost_Category_Line_Item._deleted', '=', false)
    .where('Agency_Cost_Category._deleted', '=', false)
    .orderBy(sql`lower("Agency_Cost_Category"."egcs_ay_name_en")`, 'asc')
    .orderBy(sql`lower("Agency_Cost_Category_Line_Item"."egcs_ay_name_en")`, 'asc')
    .execute()

  return {
    costCategories: distinctBilingualChoices(rows.map(row => ({
      en: row.costCategoryEn,
      fr: row.costCategoryFr
    }))),
    lineItems: distinctBilingualChoices(rows.map(row => ({
      en: row.lineItemEn,
      fr: row.lineItemFr
    })))
  }
}

/** Recursively replaces configured question choices and normalizes the cost-subsection question. */
const updateElementForQuestion = (
  element: GcFormsTemplateElement,
  replacements: Record<string, BilingualChoice[]>
): GcFormsTemplateElement => {
  const questionId = element.properties?.questionId
  const nextElement: GcFormsTemplateElement = {
    ...element,
    properties: element.properties ? { ...element.properties } : undefined
  }

  if (questionId && Object.hasOwn(replacements, questionId) && nextElement.properties) {
    nextElement.properties.choices = choicesWithBlank(replacements[questionId])
  }

  if (questionId === 'submitted_cost_subsection' && nextElement.properties) {
    nextElement.type = 'textField'
    nextElement.properties.choices = [BLANK_CHOICE]
    nextElement.properties.validation = {
      ...nextElement.properties.validation,
      required: true
    }
  }

  if (element.elements) {
    nextElement.elements = element.elements.map(child => updateElementForQuestion(child, replacements))
  }

  if (element.properties?.subElements && nextElement.properties) {
    nextElement.properties.subElements = element.properties.subElements.map(child => updateElementForQuestion(child, replacements))
  }

  return nextElement
}

/** Generates a claim form template populated with the stream's fiscal-year and budget choices. */
export const generateGcFormsClaimTemplate = async (
  rawDb: unknown,
  streamId: string
): Promise<GcFormsClaimTemplate> => {
  const [template, fiscalYears, budgetChoices] = await Promise.all([
    loadBaseClaimTemplate(),
    fetchFiscalYearChoices(rawDb, streamId),
    fetchBudgetLineItemChoices(rawDb, streamId)
  ])

  return {
    ...template,
    elements: template.elements?.map(element => updateElementForQuestion(element, {
      fiscal_year: fiscalYears,
      submitted_cost_category: budgetChoices.costCategories,
      submitted_line_item: budgetChoices.lineItems
    }))
  }
}
