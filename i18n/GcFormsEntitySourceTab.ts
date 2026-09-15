import { defineGcsExtensionMessages } from '@gcs-ssc/extensions'
export const GcFormsEntitySourceTabMessages = defineGcsExtensionMessages({
  "en": {
    "title": "GC Forms source data",
    "empty": "No GC Forms submissions have been linked to this record yet.",
    "loading": "Loading GC Forms source data…",
    "submission": "Submission",
    "status": "Status",
    "received": "Received",
    "mappings": "Mapped values",
    "mappedValuesFor": "Mapped values for {submission}",
    "value": "Value",
    "notAvailable": "Not available",
    "yes": "Yes",
    "no": "No",
    "noMappedValues": "No mapped values",
    "unknownStatus": "Unknown",
    "errorTitle": "GC Forms source data could not be loaded.",
    "errorForbidden": "You do not have permission to view GC Forms source data for this record.",
    "errorDefault": "An error occurred while loading GC Forms source data.",
    "retry": "Retry"
  },
  "fr": {
    "title": "Données sources de GC Forms",
    "empty": "Aucune soumission de GC Forms n’est encore liée à cet enregistrement.",
    "loading": "Chargement des données sources de GC Forms…",
    "submission": "Soumission",
    "status": "Statut",
    "received": "Reçue",
    "mappings": "Valeurs mises en correspondance",
    "mappedValuesFor": "Valeurs mises en correspondance pour {submission}",
    "value": "Valeur",
    "notAvailable": "Non disponible",
    "yes": "Oui",
    "no": "Non",
    "noMappedValues": "Aucune valeur mise en correspondance",
    "unknownStatus": "Inconnu",
    "errorTitle": "Impossible de charger les données sources de GC Forms.",
    "errorForbidden": "Vous n’avez pas l’autorisation de consulter les données sources de GC Forms pour cet enregistrement.",
    "errorDefault": "Une erreur s’est produite pendant le chargement des données sources de GC Forms.",
    "retry": "Réessayer"
  }
})

export const GcFormsEntitySourceTabStatusMessages = defineGcsExtensionMessages({
  "en": {
    "discovered": "Discovered",
    "downloaded": "Downloaded",
    "mapped": "Mapped",
    "materialization_failed": "Materialization failed",
    "imported": "Imported",
    "imported_pending_confirm": "Imported; confirmation pending",
    "confirmed": "Confirmed",
    "skipped": "Skipped",
    "problem": "Problem",
    "mapping_failed": "Mapping failed"
  },
  "fr": {
    "discovered": "Détectée",
    "downloaded": "Téléchargée",
    "mapped": "Mise en correspondance",
    "materialization_failed": "Échec de la matérialisation",
    "imported": "Importée",
    "imported_pending_confirm": "Importée; confirmation en attente",
    "confirmed": "Confirmée",
    "skipped": "Ignorée",
    "problem": "Problème",
    "mapping_failed": "Échec de la mise en correspondance"
  }
})
