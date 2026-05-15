# GC Forms Integration Extension

This extension connects GC Forms templates and submissions to configured GCS field mappings. It is currently hosted in the main application repository, but is intended to move to its own repository and be brought back as a submodule like the other GCS extensions.

## Credentials

GC Forms private API keys are stored through the agency extension UI. The private key is encrypted in the host-managed `extensions.secret_entry` table and is never returned to the browser after saving. Stream configuration stores only the selected `credentialId`, form ID, identity provider URL, support settings, and mappings.

The server requires `GCS_EXTENSION_SECRETS_KEY` to be configured with a base64-encoded 32-byte encryption key before credentials can be saved or used.

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
- `claim.egcs_fc_fiscalyear`: agreement budget fiscal year id.
- `claim.egcs_fc_isfinalforyear`: boolean.
- `claim.egcs_fc_periodstart`: month number from `0` to `11`.
- `claim.egcs_fc_periodend`: month number from `0` to `11`.
- `claim.egcs_fc_receiveddate`: received date.

Optional claim line-item mappings become active when at least one line-item value is present. When used, all of these are required:

- `claim_line_item.egcs_fc_fundingagreementbudgetlineitem`: budget line item id valid for the claim fiscal year.
- `claim_line_item.egcs_fc_description`: description.
- `claim_line_item.egcs_fc_amount`: amount.
- `claim_line_item.egcs_fc_currency`: currency code such as `CAD`.

## Future Work

The extension does not yet materialize agreements, proponents, monitors, attachments, or richer update/upsert flows. Current behavior is create-and-link for claims and claim line items only. Future materializers should keep host ownership boundaries explicit and should add destination links for every host record they create or update.
