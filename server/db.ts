import type { Generated, Kysely, Transaction } from 'kysely'
import type { JsonValue } from '@gcs-ssc/extensions'
import type {
  ExtensionSecretDatabase,
  ExtensionStreamContextDatabaseClient
} from '@gcs-ssc/extensions/server'

export type GcFormsSubmissionStatus =
  | 'discovered'
  | 'downloaded'
  | 'mapped'
  | 'materialization_failed'
  | 'imported'
  | 'imported_pending_confirm'
  | 'confirmed'
  | 'skipped'
  | 'problem'
  | 'mapping_failed'

export interface GcFormsIntegrationHostDatabase extends ExtensionSecretDatabase {
  'Agency_Profile': {
    id: Generated<string>
    _deleted: Generated<boolean>
  }
  'Transfer_Payment_Profile': {
    id: Generated<string>
    egcs_tp_agency: string
    _deleted: Generated<boolean>
  }
  'Transfer_Payment_Stream': {
    id: Generated<string>
    egcs_tp_transferpaymentprofile: string
    _deleted: Generated<boolean>
  }
  'Funding_Case_Agreement_Profile': {
    id: Generated<string>
    egcs_fc_agreementnumber: string
    egcs_fc_transferpaymentstream: string
    _deleted: Generated<boolean>
  }
  'Funding_Case_Agreement_Budget_Fiscal_Year': {
    id: Generated<string>
    egcs_fc_fundingagreement: string
    egcs_fc_fiscalyear: string
    _deleted: Generated<boolean>
  }
  'Agency_Fiscal_Year': {
    id: Generated<string>
    egcs_ay_fiscalyeardisplay: string
    _deleted: Generated<boolean>
  }
  'Funding_Case_Agreement_Budget_Line_Item': {
    id: Generated<string>
    egcs_fc_fundingagreementbudgetfiscalyear: string
    egcs_fc_organizationcostcategory: string
    egcs_fc_costsubsection: string
    egcs_fc_description: string
    _deleted: Generated<boolean>
  }
  'Transfer_Payment_Stream_Cost_Category_Line_Item': {
    id: Generated<string>
    egcs_tp_transferpaymentstream: string
    egcs_tp_organizationcostcategory: string
    _deleted: Generated<boolean>
  }
  'Agency_Cost_Category_Line_Item': {
    id: Generated<string>
    egcs_ay_name_en: string
    egcs_ay_name_fr: string
    egcs_ay_organizationcostcategory: string
    _deleted: Generated<boolean>
  }
  'Agency_Cost_Category': {
    id: Generated<string>
    egcs_ay_name_en: string
    egcs_ay_name_fr: string
    _deleted: Generated<boolean>
  }
  'extensions.agency_enablement': {
    id: Generated<string>
    extension_key: string
    agency_id: string
    enabled: boolean
    config: Generated<JsonValue>
    _deleted: Generated<boolean>
  }
  'extensions.stream_configuration': {
    id: Generated<string>
    extension_key: string
    stream_id: string
    enabled: boolean
    config: Generated<JsonValue>
    _deleted: Generated<boolean>
  }
  'Funding_Case_Agreement_Claim': {
    id: Generated<string>
    egcs_fc_fundingagreement: string
    egcs_fc_fiscalyear: string
    egcs_fc_isfinalforyear: boolean
    egcs_fc_periodend: number
    egcs_fc_periodstart: number
    egcs_fc_receiveddate: Date | string
    egcs_fc_gcformssubmissionuuid?: string | null
    egcs_fc_status: string
    _deleted: Generated<boolean>
  }
  'Funding_Case_Agreement_Claim_Line_Item': {
    id: Generated<string>
    egcs_fc_fundingagreementclaim: string
    egcs_fc_fundingagreementbudgetlineitem: string | null
    egcs_fc_submittedcostcategory: string | null
    egcs_fc_submittedcostsubsection: string | null
    egcs_fc_submittedlineitem: string | null
    egcs_fc_description: string
    egcs_fc_amount: number
    egcs_fc_currency: string
    _deleted: Generated<boolean>
  }
  'extensions.gcs_gcforms_connections': {
    id: Generated<string>
    agency_id: string
    stream_id: string
    credential_id: string
    credential_revision: number
    secret_entry_id: string
    secret_updated_at: Date | string
    form_id: string
    api_url: string
    identity_provider_url: string
    project_identifier: string
    contact_email: string | null
    preferred_language: 'en' | 'fr'
    status: string
    last_template_refresh_at: Date | string | null
    created_at: Generated<Date | string>
    updated_at: Date | string | null
    _deleted: Generated<boolean>
  }
  'extensions.gcs_gcforms_credentials': {
    id: Generated<string>
    agency_id: string
    name_en: string
    name_fr: string
    key_id: string
    user_id: string
    form_id: string
    revision: Generated<number>
    created_at: Generated<Date | string>
    updated_at: Date | string | null
    _deleted: Generated<boolean>
  }
  'extensions.gcs_gcforms_templates': {
    id: Generated<string>
    connection_id: string
    form_id: string
    title_en: string | null
    title_fr: string | null
    template: JsonValue
    field_catalog: JsonValue
    refreshed_at: Generated<Date | string>
    _deleted: Generated<boolean>
  }
  'extensions.gcs_gcforms_integrations': {
    id: Generated<string>
    connection_id: string
    stream_id: string
    name_en: string
    name_fr: string
    enabled: boolean
    config_fingerprint: string
    config: JsonValue
    created_at: Generated<Date | string>
    updated_at: Date | string | null
    _deleted: Generated<boolean>
  }
  'extensions.gcs_gcforms_field_mappings': {
    id: Generated<string>
    integration_id: string
    mapping_key: string
    source_question_id: string
    destination_entity: string
    destination_path: string
    transform: string
    required: boolean
    default_value: JsonValue | null
    on_missing: string
    on_invalid: string
    _deleted: Generated<boolean>
  }
  'extensions.gcs_gcforms_submissions': {
    id: Generated<string>
    connection_id: string
    integration_id: string | null
    form_id: string
    submission_name: string
    gcforms_created_at: Date | string | null
    status: GcFormsSubmissionStatus
    confirmation_code: string | null
    answers: JsonValue | null
    answers_checksum: string | null
    mapped_values: JsonValue | null
    mapping_issues: JsonValue | null
    last_error: string | null
    confirmed_at: Date | string | null
    created_at: Generated<Date | string>
    updated_at: Date | string | null
    _deleted: Generated<boolean>
  }
  'extensions.gcs_gcforms_attachments': {
    id: Generated<string>
    submission_id: string
    gcforms_attachment_id: string | null
    file_name: string
    source_url: string | null
    storage_path: string | null
    md5: string | null
    is_potentially_malicious: boolean
    downloaded_at: Date | string | null
    _deleted: Generated<boolean>
  }
  'extensions.gcs_gcforms_import_runs': {
    id: Generated<string>
    connection_id: string
    integration_id: string | null
    status: string
    started_at: Generated<Date | string>
    finished_at: Date | string | null
    discovered_count: number
    imported_count: number
    problem_count: number
    error_message: string | null
    _deleted: Generated<boolean>
  }
  'extensions.gcs_gcforms_destination_links': {
    id: Generated<string>
    submission_id: string
    mapping_id: string | null
    owner_type: string
    owner_id: string
    destination_entity: string
    destination_path: string
    value: JsonValue | null
    _deleted: Generated<boolean>
  }
  'extensions.gcs_gcforms_materialization_overrides': {
    id: Generated<string>
    submission_id: string
    destination_entity: string
    destination_path: string
    owner_type: string
    owner_id: string
    created_at: Generated<Date | string>
    updated_at: Date | string | null
    _deleted: Generated<boolean>
  }
}

export type GcFormsIntegrationDb = Kysely<GcFormsIntegrationHostDatabase>
  & ExtensionStreamContextDatabaseClient

export type GcFormsIntegrationDatabaseClient =
  | Kysely<GcFormsIntegrationHostDatabase>
  | Transaction<GcFormsIntegrationHostDatabase>

/** Narrows a host database instance to the tables used by the GC Forms integration. */
export const asGcFormsIntegrationDb = (db: unknown): GcFormsIntegrationDb =>
  db as GcFormsIntegrationDb

/** Reuses an owning transaction, or starts one when called with a root Kysely client. */
export const executeGcFormsTransaction = async <T>(
  rawDb: unknown,
  callback: (trx: GcFormsIntegrationDb) => Promise<T>
): Promise<T> => {
  const db = asGcFormsIntegrationDb(rawDb)
  if ((db as unknown as { isTransaction?: boolean }).isTransaction === true) {
    return await callback(db)
  }

  return await db.transaction().execute(async trx => await callback(asGcFormsIntegrationDb(trx)))
}
