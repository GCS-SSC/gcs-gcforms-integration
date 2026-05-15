<script setup lang="ts">
/* eslint-disable jsdoc/require-jsdoc */
import { getClientRequestUrl } from '~/utils/client-request-url'
import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import type { GcsExtensionJsonConfig, GcsExtensionRbacRequirement } from '@gcs-ssc/extensions'
import type { ExtensionEntityTabContext } from '@gcs-ssc/extensions/server'

const {
  extensionKey,
  context
} = defineProps<{
  extensionKey: string
  context: ExtensionEntityTabContext
  config: GcsExtensionJsonConfig
  rbac: GcsExtensionRbacRequirement
}>()

const { locale } = useI18n()

const labels = {
  en: {
    title: 'GC Forms source data',
    empty: 'No GC Forms submissions have been linked to this record yet.',
    loading: 'Loading',
    submission: 'Submission',
    status: 'Status',
    received: 'Received',
    mappings: 'Mapped values'
  },
  fr: {
    title: 'Donnees source GC Forms',
    empty: 'Aucune soumission GC Forms n est liee a cet enregistrement.',
    loading: 'Chargement',
    submission: 'Soumission',
    status: 'Statut',
    received: 'Recue',
    mappings: 'Valeurs mappees'
  }
}

const tLocal = (key: keyof typeof labels.en) => locale.value === 'fr' ? labels.fr[key] : labels.en[key]

interface LinkedSubmission {
  id: string
  submission_name: string
  status: string
  gcforms_created_at?: string | null
  mapped_values?: unknown
}

const items: Ref<LinkedSubmission[]> = ref([])
const isLoading: Ref<boolean> = ref(true)

const endpoint = computed(() => {
  if (context.target === 'agreement' && context.agreementId) {
    return `/api/extensions/${extensionKey}/agreements/${context.agreementId}/submissions`
  }

  if (context.target === 'proponent' && context.applicantRecipientId) {
    return `/api/extensions/${extensionKey}/proponents/${context.applicantRecipientId}/submissions`
  }

  if (context.target === 'claim' && context.claimId) {
    return `/api/extensions/${extensionKey}/claims/${context.claimId}/submissions`
  }

  if (context.target === 'monitor' && context.monitorId) {
    return `/api/extensions/${extensionKey}/monitors/${context.monitorId}/submissions`
  }

  return ''
})

const refresh = async () => {
  try {
    isLoading.value = true
    if (!endpoint.value) {
      items.value = []
      return
    }

    const response = await fetch(getClientRequestUrl(endpoint.value))
    if (!response.ok) {
      items.value = []
      return
    }
    const payload = await response.json() as { items?: LinkedSubmission[] }
    items.value = payload.items ?? []
  } finally {
    isLoading.value = false
  }
}

await refresh()

const hasItems = computed(() => items.value.length > 0)
</script>

<template>
  <section class="space-y-4">
    <div>
      <h2 class="text-lg font-semibold text-highlighted">
        {{ tLocal('title') }}
      </h2>
    </div>

    <div v-if="isLoading" class="text-sm text-muted">
      {{ tLocal('loading') }}
    </div>
    <div v-else-if="!hasItems" class="text-sm text-muted">
      {{ tLocal('empty') }}
    </div>
    <div v-else class="overflow-hidden border-y border-default">
      <table class="w-full text-left text-sm">
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
          <tr v-for="item in items" :key="item.id" class="border-t border-default">
            <td class="px-3 py-2 font-medium">
              {{ item.submission_name }}
            </td>
            <td class="px-3 py-2">
              <UBadge color="neutral" variant="subtle">
                {{ item.status }}
              </UBadge>
            </td>
            <td class="px-3 py-2 text-muted">
              {{ item.gcforms_created_at || '-' }}
            </td>
            <td class="px-3 py-2 font-mono text-xs text-muted">
              {{ JSON.stringify(item.mapped_values ?? []) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
