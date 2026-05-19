# GC Forms Integration Extension

This extension connects GC Forms templates and submissions to configured GCS field mappings.

## Credentials

GC Forms private API keys are stored through the agency extension UI. Credential metadata is stored in `extensions.gcs_gcforms_credentials`; the private key is encrypted in the host-managed `extensions.secret_entry` table using the credential row id as the secret key and is never returned to the browser after saving. Stream configuration stores only the selected `credentialId`, support settings, and mappings.

The server requires `GCS_EXTENSION_SECRETS_KEY` to be configured with a base64-encoded 32-byte encryption key before credentials can be saved or used in production. Local development may use the host seed's fixed dev key so the seeded GC Forms demo credential works after a clean database reset.

## Template Shape Guard

The stream configuration flow stores the GC Forms template shape when the template is refreshed. Sync checks the live GC Forms template before reading submissions. If the shape changed since the last reviewed refresh, sync stops with `GCS_GCFORMS_TEMPLATE_CHANGED` and does not fetch or materialize submissions.

To accept a changed GC Forms form, refresh the template from the stream configuration UI, review and update mappings as needed, save the stream configuration, and run sync again.

## Submission Confirmation

Stream configuration includes a `confirmSubmissions` switch. It defaults to `false`, so sync reads new GC Forms submissions without calling the GC Forms confirm endpoint. This keeps local/demo submissions available for repeated testing.

When `confirmSubmissions` is `true`, sync confirms a GC Forms submission only after mapping and materialization complete without issues. Confirmation may remove the submission from the GC Forms "new submissions" queue depending on the GC Forms deployment.

## Current Materializer

The supported host materializer is claims-first:

- `destinationEntity: "claim"` creates a draft `Funding_Case_Agreement_Claim`.
- `destinationEntity: "claim_line_item"` can create one `Funding_Case_Agreement_Claim_Line_Item` under the created claim when all line-item fields are present.
- Created host records are linked back to the GC Forms submission through `extensions.gcs_gcforms_destination_links`.
- Re-running sync for the same submission is idempotent: an existing active claim link prevents another claim from being created.

## Claim Mapping Conventions

Claim mappings use GC Forms answers as host field values. The parent agreement is resolved by agreement number within the configured transfer payment stream.

Example: an agreement number field on GC Forms creates a draft claim under that agreement when mapped to:

```json
{
  "destinationEntity": "claim",
  "destinationPath": "egcs_fc_fundingagreement"
}
```

Required claim mappings:

- `claim.egcs_fc_fundingagreement`: agreement number, not agreement id.
- `claim.egcs_fc_fiscalyear`: agreement budget fiscal year id or fiscal-year display label such as `2026-2027`.
- `claim.egcs_fc_isfinalforyear`: boolean.
- `claim.egcs_fc_periodstart`: month number from `0` to `11`, or a fiscal-year month label from April through March.
- `claim.egcs_fc_periodend`: month number from `0` to `11`, or a fiscal-year month label from April through March.
- `claim.egcs_fc_receiveddate`: received date.

Optional claim line-item mappings become active when at least one line-item value is present. When used, all of these are required:

- `claim_line_item.egcs_fc_fundingagreementbudgetlineitem`: budget line item id valid for the claim fiscal year.
- `claim_line_item.egcs_fc_description`: description.
- `claim_line_item.egcs_fc_amount`: amount.
- `claim_line_item.egcs_fc_currency`: currency code such as `CAD`.

## Future Work

The extension does not yet materialize agreements, proponents, monitors, attachments, or richer update/upsert flows. Current behavior is create-and-link for claims and claim line items only. Future materializers should keep host ownership boundaries explicit and should add destination links for every host record they create or update.
