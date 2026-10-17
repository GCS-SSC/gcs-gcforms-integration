import { defineGcsExtensionMessages, translateGcsExtensionMessage } from '@gcs-ssc/extensions'

export const gcFormsServerMessages = defineGcsExtensionMessages({
  en: {
    submission_not_found: 'GC Forms submission was not found for this stream.',
    submission_already_resolved: 'This GC Forms submission is no longer awaiting materialization failure resolution.',
    materialization_context_missing: 'The saved GC Forms materialization context is no longer available.',
    selected_agreement_unavailable: 'Selected agreement is not available in this transfer payment stream.',
    credential_invalid: 'The credential details are invalid.',
    credential_field_invalid: 'Review this credential field.',
    agency_required: 'Agency id is required to manage GC Forms credentials.',
    credentials_sign_in_required: 'You must be signed in to manage GC Forms credentials.',
    credentials_forbidden: 'You do not have access to manage GC Forms credentials for this agency.',
    private_key_invalid: 'The GC Forms private key is not a valid PEM private key.',
    credential_unavailable: 'The selected GC Forms credential is not available on the server.',
    credential_change_blocked: 'This GC Forms credential authentication cannot be changed until all recoverable submissions using it are resolved.',
    credential_delete_blocked: 'This GC Forms credential cannot be deleted until all recoverable submissions using it are resolved.',
    configured_status_unavailable: 'The configured imported claim status is no longer available for this agency.',
    draft_status_required: 'Claims imported from GC Forms must use the agency Draft status.',
    agreement_unavailable: 'The selected agreement is no longer available for this stream.',
    fiscal_year_unavailable: 'The selected claim fiscal year is no longer available for this agreement.',
    proponent_inactive: 'The submitting Proponent is no longer active on the selected agreement.',
    configuration_changed: 'The GC Forms configuration changed while synchronization was running. Start the synchronization again.',
    encryption_key_missing: 'The server encryption key for extension credentials is not configured.',
    credential_required: 'Select a GC Forms agency credential before syncing.',
    sync_status_required: 'Select an Agency status for claims imported from GC Forms before syncing.',
    sign_in_required: 'You must be signed in to use this GC Forms integration.',
    stream_not_found: 'Transfer payment stream was not found.',
    integration_forbidden: 'You do not have access to this GC Forms integration.',
    integration_disabled: 'GC Forms integration is not enabled for this stream.',
    missing_claim_fields: 'The GC Forms template is missing required claim fields: {fields}.',
    missing_question: 'Missing required GC Forms question: {question}.',
    template_review_required: 'Refresh and review the GC Forms template before syncing submissions.',
    template_changed_since_review: 'The GC Forms template has changed since it was last reviewed. Refresh the template, review the mappings, save the stream configuration, and sync again.',
    pending_credential_changed: 'The credential used by this pending GC Forms submission has changed.',
    disable_blocked: 'GC Forms cannot be disabled or deleted for this scope until all recoverable submissions are resolved.',
    enable_status_required: 'Select an Agency status for claims imported from GC Forms before enabling the integration.',
    imported_status_inactive: 'The selected imported claim status is not active for this agency.',
    imported_status_invalid: 'The selected imported claim status identifier is invalid.',
    imported_status_in_use: 'This status is still required by recoverable GC Forms imported claims.',
    entity_context_missing: 'The current GCS record could not be identified for the GC Forms source data.'
  },
  fr: {
    submission_not_found: 'La soumission Formulaires GC est introuvable pour ce volet.',
    submission_already_resolved: 'Cette soumission Formulaires GC n’attend plus la résolution d’un échec de matérialisation.',
    materialization_context_missing: 'Le contexte de matérialisation Formulaires GC enregistré n’est plus disponible.',
    selected_agreement_unavailable: 'L’entente sélectionnée n’est pas disponible dans ce volet de paiements de transfert.',
    credential_invalid: 'Les renseignements de l’identifiant d’authentification sont invalides.',
    credential_field_invalid: 'Vérifiez ce champ de l’identifiant d’authentification.',
    agency_required: 'L’identifiant de l’organisme est requis pour gérer les identifiants d’authentification Formulaires GC.',
    credentials_sign_in_required: 'Vous devez ouvrir une session pour gérer les identifiants d’authentification Formulaires GC.',
    credentials_forbidden: 'Vous n’avez pas accès à la gestion des identifiants d’authentification Formulaires GC pour cet organisme.',
    private_key_invalid: 'La clé privée Formulaires GC n’est pas une clé privée PEM valide.',
    credential_unavailable: 'L’identifiant d’authentification Formulaires GC sélectionné n’est pas disponible sur le serveur.',
    credential_change_blocked: 'L’authentification de cet identifiant d’authentification Formulaires GC ne peut pas être modifiée tant que toutes les soumissions récupérables qui l’utilisent ne sont pas réglées.',
    credential_delete_blocked: 'Cet identifiant d’authentification Formulaires GC ne peut pas être supprimé tant que toutes les soumissions récupérables qui l’utilisent ne sont pas réglées.',
    configured_status_unavailable: 'Le statut configuré des demandes de remboursement importées n’est plus disponible pour cet organisme.',
    draft_status_required: 'Les demandes de remboursement importées de Formulaires GC doivent utiliser le statut d’ébauche de l’organisme.',
    agreement_unavailable: 'L’entente sélectionnée n’est plus disponible pour ce volet.',
    fiscal_year_unavailable: 'L’exercice financier sélectionné pour la demande de remboursement n’est plus disponible pour cette entente.',
    proponent_inactive: 'Le promoteur qui soumet la demande de remboursement n’est plus actif sur l’entente sélectionnée.',
    configuration_changed: 'La configuration de Formulaires GC a changé pendant la synchronisation. Relancez la synchronisation.',
    encryption_key_missing: 'La clé de chiffrement serveur pour les identifiants d’authentification d’extension n’est pas configurée.',
    credential_required: 'Sélectionnez un identifiant d’authentification Formulaires GC de l’organisme avant la synchronisation.',
    sync_status_required: 'Sélectionnez un statut d’organisme pour les demandes de remboursement importées de Formulaires GC avant la synchronisation.',
    sign_in_required: 'Vous devez ouvrir une session pour utiliser cette intégration Formulaires GC.',
    stream_not_found: 'Le volet de paiements de transfert est introuvable.',
    integration_forbidden: 'Vous n’avez pas accès à cette intégration Formulaires GC.',
    integration_disabled: 'L’intégration Formulaires GC n’est pas activée pour ce volet.',
    missing_claim_fields: 'Le modèle Formulaires GC ne contient pas les champs de demande de remboursement requis : {fields}.',
    missing_question: 'Question Formulaires GC requise manquante : {question}.',
    template_review_required: 'Actualisez et vérifiez le modèle Formulaires GC avant de synchroniser les soumissions.',
    template_changed_since_review: 'Le modèle Formulaires GC a changé depuis sa dernière vérification. Actualisez le modèle, vérifiez les correspondances, enregistrez la configuration du volet, puis synchronisez de nouveau.',
    pending_credential_changed: 'L’identifiant d’authentification utilisé par cette soumission Formulaires GC en attente a changé.',
    disable_blocked: 'Formulaires GC ne peut pas être désactivé ni supprimé pour cette portée tant que toutes les soumissions récupérables ne sont pas réglées.',
    enable_status_required: 'Sélectionnez un statut d’organisme pour les demandes de remboursement importées de Formulaires GC avant d’activer l’intégration.',
    imported_status_inactive: 'Le statut sélectionné pour les demandes de remboursement importées n’est pas actif pour cet organisme.',
    imported_status_invalid: 'L’identifiant du statut sélectionné pour les demandes de remboursement importées est invalide.',
    imported_status_in_use: 'Ce statut est toujours requis par des demandes de remboursement importées récupérables de Formulaires GC.',
    entity_context_missing: 'Impossible d’identifier l’enregistrement GCS courant pour les données sources de Formulaires GC.'
  }
})

/**
 * Builds the bilingual SDK error transport from the extension-owned catalog.
 * @param key - Stable catalog message key.
 * @param params - Literal interpolation values.
 * @returns English and French display-ready error messages.
 */
export const gcFormsUserMessage = (
  key: keyof typeof gcFormsServerMessages.en,
  params: Record<string, string | number | boolean> = {}
): { en: string; fr: string } => ({
  en: translateGcsExtensionMessage(gcFormsServerMessages, 'en', key, params),
  fr: translateGcsExtensionMessage(gcFormsServerMessages, 'fr', key, params)
})
