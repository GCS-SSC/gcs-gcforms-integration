import { defineGcsExtensionMessages } from '@gcs-ssc/extensions'
export const GCFORMS_DIAGNOSTIC_MESSAGES = defineGcsExtensionMessages({
  "en": {
    "missing_required_value": "A required GC Forms value is missing for {destinationPath}.",
    "invalid_value": "The GC Forms value for {destinationPath} cannot be transformed.",
    "unsupported_destination": "The configured destination {destinationEntity} is not supported for claim materialization.",
    "claim_required_value_missing": "A required claim value is missing for {destinationPath}.",
    "claim_values_invalid": "Claim values could not be converted for {destinationPath}.",
    "claim_period_invalid": "The claim period at {destinationPath} must be within one fiscal year.",
    "agreement_not_found": "The agreement for {destinationPath} could not be found in this transfer payment stream.",
    "agreement_override_unavailable": "The selected agreement for {destinationPath} is no longer available in this transfer payment stream.",
    "claim_fiscal_year_invalid": "The claim fiscal year for {destinationPath} is not valid for the resolved agreement.",
    "claim_line_item_required_value_missing": "A required claim line item value is missing for {destinationPath} in row {row}.",
    "claim_line_item_values_invalid": "Claim line item values could not be converted for {destinationPath} in row {row}.",
    "submission_processing_failed": "GC Forms could not process this submission.",
    "submission_status_invalid": "The configured GC Forms submission status is invalid ({statusCode})."
  },
  "fr": {
    "missing_required_value": "Une valeur GC Forms obligatoire est manquante pour {destinationPath}.",
    "invalid_value": "La valeur GC Forms pour {destinationPath} ne peut pas être transformée.",
    "unsupported_destination": "La destination configurée {destinationEntity} n’est pas prise en charge pour la matérialisation des réclamations.",
    "claim_required_value_missing": "Une valeur de réclamation obligatoire est manquante pour {destinationPath}.",
    "claim_values_invalid": "Les valeurs de réclamation n’ont pas pu être converties pour {destinationPath}.",
    "claim_period_invalid": "La période de réclamation à {destinationPath} doit se situer dans un seul exercice financier.",
    "agreement_not_found": "L’entente pour {destinationPath} est introuvable dans ce volet de paiements de transfert.",
    "agreement_override_unavailable": "L’entente sélectionnée pour {destinationPath} n’est plus disponible dans ce volet de paiements de transfert.",
    "claim_fiscal_year_invalid": "L’exercice financier de la réclamation pour {destinationPath} n’est pas valide pour l’entente résolue.",
    "claim_line_item_required_value_missing": "Une valeur obligatoire de ligne de réclamation est manquante pour {destinationPath} à la ligne {row}.",
    "claim_line_item_values_invalid": "Les valeurs de la ligne de réclamation n’ont pas pu être converties pour {destinationPath} à la ligne {row}.",
    "submission_processing_failed": "GC Forms n’a pas pu traiter cette soumission.",
    "submission_status_invalid": "Le statut configuré pour les soumissions GC Forms n’est pas valide ({statusCode})."
  }
})
export const UNKNOWN_DIAGNOSTIC_MESSAGES = defineGcsExtensionMessages({
  "en": {
    "unknown": "GC Forms could not complete this mapping."
  },
  "fr": {
    "unknown": "GC Forms n’a pas pu terminer cette correspondance."
  }
})
