<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Ref } from 'vue'
import { FetchResponseError } from '@gcs-ssc/extensions'
import type { GcsExtensionJsonConfig, GcsExtensionRbacRequirement } from '@gcs-ssc/extensions'
import type { ExtensionEntityTabContext } from '@gcs-ssc/extensions'
import {
  ExtensionBadge,
  ExtensionButton,
  useExtensionApi,
  useExtensionI18n
} from '@gcs-ssc/extensions/ui'
import { buildGcFormsEntitySourceEndpoint } from './gcforms-entity-source-tab'

const {
  extensionKey,
  context
} = defineProps<{
  extensionKey: string
  context: ExtensionEntityTabContext
  config: GcsExtensionJsonConfig
  rbac: GcsExtensionRbacRequirement
}>()

const { locale } = useExtensionI18n()
const api = useExtensionApi(extensionKey)

const labels = {
  en: {
    title: 'GC Forms source data',
    empty: 'No GC Forms submissions have been linked to this record yet.',
    loading: 'Loading GC Forms source data…',
    submission: 'Submission',
    status: 'Status',
    received: 'Received',
    mappings: 'Mapped values',
    mappedValuesFor: 'Mapped values for {submission}',
    value: 'Value',
    notAvailable: 'Not available',
    yes: 'Yes',
    no: 'No',
    noMappedValues: 'No mapped values',
    unknownStatus: 'Unknown',
    errorTitle: 'GC Forms source data could not be loaded.',
    errorForbidden: 'You do not have permission to view GC Forms source data for this record.',
    errorDefault: 'An error occurred while loading GC Forms source data.',
    retry: 'Retry'
  },
  fr: {
    title: 'Données sources de GC Forms',
    empty: "Aucune soumission de GC Forms n’est encore liée à cet enregistrement.",
    loading: 'Chargement des données sources de GC Forms…',
    submission: 'Soumission',
    status: 'Statut',
    received: 'Reçue',
    mappings: 'Valeurs mises en correspondance',
    mappedValuesFor: 'Valeurs mises en correspondance pour {submission}',
    value: 'Valeur',
    notAvailable: 'Non disponible',
    yes: 'Oui',
    no: 'Non',
    noMappedValues: 'Aucune valeur mise en correspondance',
    unknownStatus: 'Inconnu',
    errorTitle: 'Impossible de charger les données sources de GC Forms.',
    errorForbidden: 'Vous n’avez pas l’autorisation de consulter les données sources de GC Forms pour cet enregistrement.',
    errorDefault: 'Une erreur s’est produite pendant le chargement des données sources de GC Forms.',
    retry: 'Réessayer'
  }
}

const statusLabels = {
  en: {
    discovered: 'Discovered',
    downloaded: 'Downloaded',
    mapped: 'Mapped',
    materialization_failed: 'Materialization failed',
    imported: 'Imported',
    imported_pending_confirm: 'Imported; confirmation pending',
    confirmed: 'Confirmed',
    skipped: 'Skipped',
    problem: 'Problem',
    mapping_failed: 'Mapping failed'
  },
  fr: {
    discovered: 'Détectée',
    downloaded: 'Téléchargée',
    mapped: 'Mise en correspondance',
    materialization_failed: 'Échec de la matérialisation',
    imported: 'Importée',
    imported_pending_confirm: 'Importée; confirmation en attente',
    confirmed: 'Confirmée',
    skipped: 'Ignorée',
    problem: 'Problème',
    mapping_failed: 'Échec de la mise en correspondance'
  }
} as const

type LocalLabelKey = keyof typeof labels.en
type StatusCode = keyof typeof statusLabels.en

const tLocal = (key: LocalLabelKey): string => locale.value === 'fr' ? labels.fr[key] : labels.en[key]

const interpolateLocal = (key: LocalLabelKey, values: Record<string, string>): string =>
  Object.entries(values).reduce(
    (message, [name, value]) => message.replace(`{${name}}`, value),
    tLocal(key)
  )

interface LinkedSubmission {
  id: string
  submission_name: string
  status: string
  gcforms_created_at?: string | null
  mapped_values?: unknown
}

interface LoadError {
  statusCode: number | null
}

interface MappedDisplayRow {
  id: string
  label: string
  value: string
}

const items: Ref<LinkedSubmission[]> = ref([])
const isLoading: Ref<boolean> = ref(true)
const loadError: Ref<LoadError | null> = ref(null)

const endpoint = computed(() => buildGcFormsEntitySourceEndpoint(context))
const localeCode = computed(() => locale.value === 'fr' ? 'fr-CA' : 'en-CA')
const dateFormatter = computed(() => new Intl.DateTimeFormat(localeCode.value, {
  dateStyle: 'medium'
}))
const numberFormatter = computed(() => new Intl.NumberFormat(localeCode.value))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const formatScalar = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return tLocal('notAvailable')
  }

  if (typeof value === 'boolean') {
    return tLocal(value ? 'yes' : 'no')
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return numberFormatter.value.format(value)
  }

  return String(value)
}

const appendMappedRows = (
  rows: MappedDisplayRow[],
  value: unknown,
  label: string,
  id: string
): void => {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      rows.push({ id, label, value: tLocal('noMappedValues') })
      return
    }

    value.forEach((entry, index) => {
      appendMappedRows(rows, entry, `${label}[${index + 1}]`, `${id}.${index}`)
    })
    return
  }

  if (isRecord(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) {
      rows.push({ id, label, value: tLocal('noMappedValues') })
      return
    }

    entries.forEach(([key, entry]) => {
      appendMappedRows(rows, entry, `${label}.${key}`, `${id}.${key}`)
    })
    return
  }

  rows.push({ id, label, value: formatScalar(value) })
}

const mappedDisplayRows = (mappedValues: unknown): MappedDisplayRow[] => {
  if (mappedValues === null || mappedValues === undefined) {
    return []
  }

  const rows: MappedDisplayRow[] = []
  const candidates = Array.isArray(mappedValues) ? mappedValues : [mappedValues]
  candidates.forEach((candidate, index) => {
    if (isRecord(candidate) && typeof candidate.destinationPath === 'string' && 'value' in candidate) {
      const mappingId = typeof candidate.mappingId === 'string' && candidate.mappingId
        ? candidate.mappingId
        : `mapping-${index}`
      appendMappedRows(rows, candidate.value, candidate.destinationPath, mappingId)
      return
    }

    const label = candidates.length === 1 ? tLocal('value') : `${tLocal('value')} ${index + 1}`
    appendMappedRows(rows, candidate, label, `value-${index}`)
  })

  return rows
}

const localizedStatus = (status: string): string => {
  const statusCode = status as StatusCode
  const localizedStatuses = locale.value === 'fr' ? statusLabels.fr : statusLabels.en
  return localizedStatuses[statusCode] ?? tLocal('unknownStatus')
}

const formatReceivedDate = (value: string | null | undefined): string => {
  if (!value) {
    return tLocal('notAvailable')
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? tLocal('notAvailable') : dateFormatter.value.format(date)
}

const mappedValuesLabel = (submissionName: string): string =>
  interpolateLocal('mappedValuesFor', { submission: submissionName })

const errorDescription = computed(() => loadError.value?.statusCode === 403
  ? tLocal('errorForbidden')
  : tLocal('errorDefault'))

const refresh = async () => {
  try {
    isLoading.value = true
    loadError.value = null
    if (!endpoint.value) {
      items.value = []
      return
    }

    const payload = await api.get<{ items?: LinkedSubmission[] }>(endpoint.value)
    items.value = payload.items ?? []
  } catch (error: unknown) {
    items.value = []
    loadError.value = {
      statusCode: error instanceof FetchResponseError ? error.response.status : null
    }
  } finally {
    isLoading.value = false
  }
}

onMounted(refresh)

const hasItems = computed(() => items.value.length > 0)
</script>

<template>
  <section class="min-w-0 max-w-full space-y-4">
    <div>
      <h2 class="text-lg font-semibold text-highlighted">
        {{ tLocal('title') }}
      </h2>
    </div>

    <div v-if="isLoading" role="status" class="text-sm text-muted">
      {{ tLocal('loading') }}
    </div>
    <div
      v-else-if="loadError"
      role="alert"
      class="flex flex-col items-start gap-3 border-y border-error/30 bg-error/5 px-4 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0 space-y-1">
        <p class="font-medium text-highlighted">
          {{ tLocal('errorTitle') }}
        </p>
        <p class="text-muted">
          {{ errorDescription }}
        </p>
      </div>
      <ExtensionButton
        color="neutral"
        variant="outline"
        icon="i-lucide-refresh-cw"
        :loading="isLoading"
        @click="refresh">
        {{ tLocal('retry') }}
      </ExtensionButton>
    </div>
    <div v-else-if="!hasItems" data-testid="gcforms-empty-state" class="text-sm text-muted">
      {{ tLocal('empty') }}
    </div>
    <div
      v-else
      data-testid="gcforms-table-scroll"
      class="gcforms-table-scroll max-w-full overflow-x-auto overscroll-x-contain border-y border-default"
      tabindex="0"
      :aria-label="tLocal('title')">
      <table class="w-full min-w-[48rem] table-fixed text-left text-sm">
        <colgroup>
          <col class="w-40">
          <col class="w-48">
          <col class="w-40">
          <col>
        </colgroup>
        <thead class="bg-muted/40 text-muted">
          <tr>
            <th class="px-3 py-2 font-medium">
              {{ tLocal('submission') }}
            </th>
            <th class="px-3 py-2 font-medium">
              {{ tLocal('status') }}
            </th>
            <th class="px-3 py-2 font-medium">
              {{ tLocal('received') }}
            </th>
            <th class="px-3 py-2 font-medium">
              {{ tLocal('mappings') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id" class="border-t border-default align-top">
            <td class="px-3 py-3 font-medium">
              {{ item.submission_name }}
            </td>
            <td class="px-3 py-3">
              <ExtensionBadge color="neutral" variant="subtle">
                {{ localizedStatus(item.status) }}
              </ExtensionBadge>
            </td>
            <td class="px-3 py-3 whitespace-nowrap text-muted">
              {{ formatReceivedDate(item.gcforms_created_at) }}
            </td>
            <td class="min-w-0 px-3 py-3 text-xs text-muted">
              <div
                class="gcforms-mapped-values-scroll w-full max-w-full overflow-x-auto overscroll-x-contain"
                tabindex="0"
                :aria-label="mappedValuesLabel(item.submission_name)">
                <dl v-if="mappedDisplayRows(item.mapped_values).length" class="w-max min-w-full space-y-2">
                  <div
                    v-for="row in mappedDisplayRows(item.mapped_values)"
                    :key="row.id"
                    class="flex min-w-max items-baseline gap-3">
                    <dt class="font-medium text-highlighted">
                      {{ row.label }}
                    </dt>
                    <dd class="whitespace-nowrap font-mono">
                      {{ row.value }}
                    </dd>
                  </div>
                </dl>
                <span v-else>{{ tLocal('noMappedValues') }}</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
