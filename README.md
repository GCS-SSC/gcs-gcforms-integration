# GC Forms Integration Extension

This extension connects GC Forms templates and submissions to configured GCS field mappings.

## Credentials

GC Forms private API keys are stored through the agency extension UI. Credential metadata is stored in `extensions.gcs_gcforms_credentials`; the private key is encrypted in the host-managed `extensions.secret_entry` table using the credential row id as the secret key and is never returned to the browser after saving. Stream configuration stores only the selected `credentialId`, support settings, and mappings.

Credential mutation and deletion are serialized with sync, confirmation, and manual-recovery writes through the agency extension lifecycle lock. Authentication material (`key`, key id, user id, or form id) cannot be changed, and a credential cannot be deleted, while any historical connection using it has an `imported_pending_confirm` or recoverable `materialization_failed` submission. Rejected changes preserve the credential row and encrypted secret until recovery completes, including after a stream rotates to a replacement credential. Bilingual label-only edits and edit-form payloads that repeat the current authentication values remain safe and do not advance the credential authentication revision or rewrite the encrypted secret.

The extension also registers the SDK lifecycle guard used by the host's actual disable and deletion paths. Agency disable/deletion and stream disable/deletion are rejected while the affected scope contains an `imported_pending_confirm` or `materialization_failed` row on any historical connection. The guard uses the same ordered agency/stream lifecycle locks as import and reconciliation, so it observes a recoverable row committed immediately before disable/deletion and waits for an in-flight recovery before deciding whether the scope is safe to change.

The server requires `GCS_EXTENSION_SECRETS_KEY` to be configured with a base64-encoded 32-byte encryption key before credentials can be saved or used in production. Local development may use the host seed's fixed dev key so the seeded GC Forms demo credential works after a clean database reset.

## Template Shape Guard

The stream configuration flow stores the GC Forms template shape when the template is refreshed. Sync checks the live GC Forms template before reading submissions. If the shape changed since the last reviewed refresh, sync stops with `GCS_GCFORMS_TEMPLATE_CHANGED` and does not fetch or materialize submissions. The error carries the failing sync session's configuration fingerprint, connection and credential ids, credential authentication revision, and encrypted-secret identity marker. The renewed write phase marks `templateShapeChanged` only when that complete identity still matches; a concurrent configuration, credential rotation, or credential authentication edit instead returns `GCS_GCFORMS_CONFIG_CHANGED` without modifying the replacement configuration.

To accept a changed GC Forms form, refresh the template from the stream configuration UI, review and update mappings as needed, save the stream configuration, and run sync again.

## Submission Confirmation

Stream configuration includes a `confirmSubmissions` switch. It defaults to `false`, so sync reads new GC Forms submissions without calling the GC Forms confirm endpoint. This keeps local/demo submissions available for repeated testing.

When `confirmSubmissions` is `true`, sync confirms a GC Forms submission only after mapping and materialization complete without issues. Confirmation may remove the submission from the GC Forms "new submissions" queue depending on the GC Forms deployment.

Successful materialization first commits locally as `imported_pending_confirm`. Template discovery, new-submission listing, historical pending discovery, and submission decryption run outside database locks. Every remote token and API request has a bounded timeout and bounded JSON response size; the new-submission list additionally rejects more than 500 metadata rows or more than 256 KiB. Sync captures the credential authentication revision and encrypted-secret identity used for those remote reads, then reacquires current host authorization and agency/stream lifecycle locks for each short local batch. The batch is rejected with `GCS_GCFORMS_CONFIG_CHANGED` before materialization if the active configuration, connection, credential authentication revision, or encrypted secret changed while remote work was in progress.

Each sync phase has a stable cap of 25 records. Remote submissions are ordered by GC Forms `createdAt` and then submission `name`; never-seen persisted identities are selected before retryable identities, while locally completed identities do not consume the cap. This gives `limit + 1` a durable continuation path even when confirmation is disabled and GC Forms keeps completed submissions in its new-submission list. Selected submissions are downloaded, decrypted, and committed one at a time, so the server never retains a batch of decrypted payloads. Historical pending confirmations are ordered by their persisted submission bigint id and limited to 25 per run. At most those 25 historical rows can introduce historical new-submission requests during one sync; later runs continue with the next persisted ids.

The confirmation phase first renews authorization and lifecycle locks, reloads the pending row with its persisted confirmation policy and historical routing metadata, and decides whether a remote call remains necessary. If confirmation is disabled for that persisted integration, or discovery shows that GC Forms already removed the submission from its new queue, the route finalizes the local status without calling the old remote endpoint. Otherwise the transaction commits, the route reloads and validates the historical credential and secret, constructs the client, and makes one bounded remote confirmation call. A second fresh-authorized, lifecycle-locked transaction then rechecks the pending row and confirmation code before finalizing the local status. Authorization revocation may defer that final step after the remote call, but the durable pending marker allows a later sync to reconcile it safely; lifecycle guards prevent extension or scope disablement while the marker remains pending.

Every sync begins with a renewed, lifecycle-locked local preflight. When the current merged configuration disables confirmation, that preflight finalizes the next 25 pending rows in ascending persisted submission-id order before any current or historical GC Forms client is created and before template, submission-list, or decryption requests. Later runs continue with the next ordered rows. This recovery does not require the old credential, private key, form endpoint, or identity-provider endpoint. Normal remote synchronization starts only after the preflight commits; if later credential validation or remote preparation fails, the recovered rows remain finalized and no longer block credential or scope lifecycle guards. When confirmation remains enabled, pending rows retain their historical-client confirmation path.

Recovery continues through pending rows across every historical connection for the stream, not only the currently configured credential, in ordered 25-row phases. Credential rotation therefore does not strand older pending rows: retries use the API, identity-provider, project, credential, and form metadata attached to each row's own connection. If the call or commit fails, the marker remains recoverable; a later sync retries it when it is still remote, or finalizes it idempotently after GC Forms has removed it. Existing destination links continue to prevent duplicate claims during retries.

Connection rows are immutable versions of the complete remote identity: stream, credential, credential authentication revision, encrypted-secret row and version, form, API endpoint, identity-provider endpoint, and project. Changing any of those values creates or reuses a distinct version instead of rewriting the route stored on an older submission. Concurrent creation of the same version is idempotent, and soft-deleted versions are excluded from current configuration lookup while historical pending recovery deliberately retains its original version.

Integration rows and their field mappings are immutable configuration versions as well. A normalized full-configuration fingerprint selects or atomically creates a version, and submissions retain the exact integration and mapping set used when they were imported or failed. Editing mappings therefore cannot rewrite the retry context of an earlier failure. Concurrent setup of the same integration version is idempotent and publishes its mappings in the same transaction.

When GC Forms still lists a submission whose same connection already has a durable pending marker, sync does not re-run checksum verification, normalization, mapping, materialization, or attachment replacement over that row. It preserves the original confirmation code and `imported_pending_confirm` status, then queues the row directly for reconciliation. Malformed or changed retry content therefore cannot downgrade the durable recovery marker to `problem`, `mapping_failed`, or another import status.

Manual materialization-failure resolution is restricted to submissions whose current status is exactly `materialization_failed`. Agreement choices come from the host's agreement-level read/team visibility contract; invisible saved selections are not returned. The write renews authorization, takes the stream lifecycle lock, freshly locks and authorizes `agreement:update` for the selected agreement in its current stream, then locks the submission through its historical connection scope and uses that submission's persisted integration mapping context. Agreement deletion, scope drift, or revoked agreement access therefore fails before an override or claim can be written. A submission that has already advanced to `imported_pending_confirm`, `imported`, or another status returns a bilingual conflict without saving an override, materializing a claim, or changing status; the final status write also retains an explicit `materialization_failed` predicate.

Mapping failures persist only stable diagnostic codes and JSON parameters. English or French display text is rendered from the request or interface locale at API and UI boundaries; it is never written to submission or import-run rows. Unknown codes, invalid params, and incomplete placeholders use a generic localized message without exposing the code or parameter values. Clean-slate storage does not accept or retain the superseded message-only issue contract.

When manual resolution creates a claim, it also follows that historical integration version's confirmation policy. Confirmation-enabled recovery first commits `imported_pending_confirm`, then renews authorization and lifecycle locks before confirming through the historical connection; only successful reconciliation returns the final `imported` response. Confirmation-disabled recovery commits directly as `imported` and makes no remote confirmation call.

The submissions list endpoint is strictly read-only. It queries the already-persisted connection version matching the current configuration and returns the normal empty list contract when setup has not yet created that version. Repeated reads never create or update connections, integrations, or mappings; setup remains confined to authorized, lifecycle-locked update and synchronization operations.

Configured mappings must include a supported `claim` or `claim_line_item` destination. A submission
whose configured mappings target only unsupported destinations is stored with a stable
`unsupported_destination` materialization issue and is never confirmed.

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
