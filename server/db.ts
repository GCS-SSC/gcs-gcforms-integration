import type { Generated, Kysely } from 'kysely'
import type { JsonValue } from '@gcs-ssc/extensions'

export type GcFormsSubmissionStatus =
  | 'discovered'
  | 'downloaded'
  | 'mapped'
  | 'materialization_failed'
  | 'imported'
  | 'imported_pending_confirm'
  | 'confirmed'
  | 'problem'
  | 'mapping_failed'

export interface GcFormsIntegrationHostDatabase {
  'Funding_Case_Agreement_Profile': {
    id: Generated<string>
    egcs_fc_agreementnumber: string
    egcs_fc_transferpaymentstream: string
    _deleted: Generated<boolean>
  }
  'Funding_Case_Agreement_Budget_Fiscal_Year': {
    id: Generated<string>
    egcs_fc_fundingagreement: string
    _deleted: Generated<boolean>
  }
  'Funding_Case_Agreement_Budget_Line_Item': {
    id: Generated<string>
    egcs_fc_fundingagreementbudgetfiscalyear: string
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
    egcs_fc_status: string
    _deleted: Generated<boolean>
  }
  'Funding_Case_Agreement_Claim_Line_Item': {
    id: Generated<string>
    egcs_fc_fundingagreementclaim: string
    egcs_fc_fundingagreementbudgetlineitem: string
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
  'extensions.secret_entry': {
    id: Generated<string>
    extension_key: string
    owner_type: string
    owner_id: string
    secret_key: string
    ciphertext: string
    iv: string
    auth_tag: string
    algorithm: string
    key_version: number
    metadata: Generated<JsonValue>
    created_at: Generated<Date | string>
    updated_at: Date | string | null
    _deleted: Generated<boolean>
  }
}

export type GcFormsIntegrationDb = Kysely<GcFormsIntegrationHostDatabase>

export const asGcFormsIntegrationDb = (db: unknown): GcFormsIntegrationDb =>
  db as GcFormsIntegrationDb
