<script setup lang="ts">
/* eslint-disable jsdoc/require-jsdoc */
import { onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { GcsExtensionJsonConfig, GcsResolvedExtension } from '@gcs-ssc/extensions'
import {
  DEFAULT_GCFORMS_API_URL,
  parseGcFormsAgencyConfig,
  type GcFormsCredentialSummary,
  type GcsGcFormsAgencyConfig
} from '../shared/gcforms'

const { agencyId } = defineProps<{
  extension: GcsResolvedExtension
  agencyId: string
}>()

const config = defineModel<GcsExtensionJsonConfig>({ required: true })
const { locale } = useI18n()

const labels = {
  en: {
    connection: 'GC Forms instance',
    description: 'Set the GC Forms API base URL for this agency. Use the hosted GC Forms URL or a locally hosted instance.',
    apiUrl: 'API base URL',
    apiUrlHelp: 'Example: http://localhost:3000/v1',
    defaultUrl: 'Hosted GC Forms default',
    credentials: 'Credentials',
    credentialsDescription: 'Store GC Forms private API keys for this agency. Private keys are encrypted and are never shown after saving.',
    credentialId: 'Credential ID',
    keyId: 'Key ID',
    userId: 'User ID',
    formId: 'Form ID',
    privateKey: 'Private key',
    saveCredential: 'Save credential',
    saved: 'Credential saved.',
    deleted: 'Credential deleted.',
    failed: 'Credential action failed.',
    noCredentials: 'No credentials have been saved yet.',
    remove: 'Remove'
  },
  fr: {
    connection: 'Instance GC Forms',
    description: 'Definissez l URL de base de l API GC Forms pour cette organisation. Utilisez l URL hebergee de GC Forms ou une instance locale.',
    apiUrl: 'URL de base de l API',
    apiUrlHelp: 'Exemple : http://localhost:3000/v1',
    defaultUrl: 'Valeur par defaut de GC Forms heberge',
    credentials: 'Justificatifs',
    credentialsDescription: 'Enregistrez les cles API privees GC Forms pour cette organisation. Les cles privees sont chiffrees et ne sont jamais affichees apres l enregistrement.',
    credentialId: 'ID du justificatif',
    keyId: 'ID de la cle',
    userId: 'ID utilisateur',
    formId: 'ID du formulaire',
    privateKey: 'Cle privee',
    saveCredential: 'Enregistrer le justificatif',
    saved: 'Justificatif enregistre.',
    deleted: 'Justificatif supprime.',
    failed: 'Action du justificatif echouee.',
    noCredentials: 'Aucun justificatif n a encore ete enregistre.',
    remove: 'Supprimer'
  }
}

const tLocal = (key: keyof typeof labels.en) => locale.value === 'fr' ? labels.fr[key] : labels.en[key]

const localConfig: Ref<GcsGcFormsAgencyConfig> = ref(parseGcFormsAgencyConfig(config.value))
const credentials: Ref<GcFormsCredentialSummary[]> = ref([])
const credentialForm: Ref<{
  credentialId: string
  keyId: string
  userId: string
  formId: string
  key: string
}> = ref({
  credentialId: '',
  keyId: '',
  userId: '',
  formId: '',
  key: ''
})
const isLoadingCredentials: Ref<boolean> = ref(false)
const isSavingCredential: Ref<boolean> = ref(false)
const statusMessage: Ref<string> = ref('')

watch(localConfig, value => {
  config.value = {
    apiUrl: value.apiUrl || null
  }
}, { deep: true })

watch(config, value => {
  localConfig.value = parseGcFormsAgencyConfig(value)
})

const credentialEndpoint = `/api/extensions/gcs-gcforms-integration/agencies/${agencyId}/credentials`

const refreshCredentials = async () => {
  try {
    isLoadingCredentials.value = true
    const response = await fetch(credentialEndpoint)
    if (!response.ok) {
      credentials.value = []
      return
    }
    const payload = await response.json() as { items?: GcFormsCredentialSummary[] }
    credentials.value = payload.items ?? []
  } finally {
    isLoadingCredentials.value = false
  }
}

const saveCredential = async () => {
  try {
    isSavingCredential.value = true
    statusMessage.value = ''
    const response = await fetch(credentialEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(credentialForm.value)
    })
    if (!response.ok) {
      throw new Error('failed')
    }

    credentialForm.value.key = ''
    statusMessage.value = tLocal('saved')
    await refreshCredentials()
  } catch {
    statusMessage.value = tLocal('failed')
  } finally {
    isSavingCredential.value = false
  }
}

const deleteCredential = async (credentialId: string) => {
  try {
    statusMessage.value = ''
    const response = await fetch(`${credentialEndpoint}/${encodeURIComponent(credentialId)}`, {
      method: 'DELETE'
    })
    if (!response.ok) {
      throw new Error('failed')
    }
    statusMessage.value = tLocal('deleted')
    await refreshCredentials()
  } catch {
    statusMessage.value = tLocal('failed')
  }
}

onMounted(async () => {
  await refreshCredentials()
})
</script>

<template>
  <section class="space-y-4">
    <div>
      <h3 class="text-base font-semibold text-highlighted">
        {{ tLocal('connection') }}
      </h3>
      <p class="mt-1 text-sm text-muted">
        {{ tLocal('description') }}
      </p>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <UFormField :label="tLocal('apiUrl')" :description="tLocal('apiUrlHelp')">
        <UInput v-model="localConfig.apiUrl" :placeholder="DEFAULT_GCFORMS_API_URL" />
      </UFormField>
    </div>

    <p class="text-sm text-muted">
      {{ tLocal('defaultUrl') }}: {{ DEFAULT_GCFORMS_API_URL }}
    </p>
  </section>

  <section class="mt-8 space-y-4">
    <div>
      <h3 class="text-base font-semibold text-highlighted">
        {{ tLocal('credentials') }}
      </h3>
      <p class="mt-1 text-sm text-muted">
        {{ tLocal('credentialsDescription') }}
      </p>
    </div>

    <div v-if="credentials.length === 0 && !isLoadingCredentials" class="text-sm text-muted">
      {{ tLocal('noCredentials') }}
    </div>
    <div v-else class="overflow-hidden border-y border-default">
      <table class="w-full text-left text-sm">
        <thead class="bg-muted/40 text-muted">
          <tr>
            <th class="px-3 py-2 font-medium">
              {{ tLocal('credentialId') }}
            </th>
            <th class="px-3 py-2 font-medium">
              {{ tLocal('keyId') }}
            </th>
            <th class="px-3 py-2 font-medium">
              {{ tLocal('userId') }}
            </th>
            <th class="px-3 py-2 font-medium">
              {{ tLocal('formId') }}
            </th>
            <th class="px-3 py-2 font-medium">
              {{ tLocal('remove') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="credential in credentials" :key="credential.credentialId" class="border-t border-default">
            <td class="px-3 py-2 font-mono text-xs">
              {{ credential.credentialId }}
            </td>
            <td class="px-3 py-2">
              {{ credential.keyId }}
            </td>
            <td class="px-3 py-2">
              {{ credential.userId }}
            </td>
            <td class="px-3 py-2">
              {{ credential.formId }}
            </td>
            <td class="px-3 py-2">
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="sm"
                class="cursor-default"
                :aria-label="tLocal('remove')"
                @click="deleteCredential(credential.credentialId)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <UFormField :label="tLocal('credentialId')">
        <UInput v-model="credentialForm.credentialId" />
      </UFormField>
      <UFormField :label="tLocal('keyId')">
        <UInput v-model="credentialForm.keyId" />
      </UFormField>
      <UFormField :label="tLocal('userId')">
        <UInput v-model="credentialForm.userId" />
      </UFormField>
      <UFormField :label="tLocal('formId')">
        <UInput v-model="credentialForm.formId" />
      </UFormField>
      <UFormField :label="tLocal('privateKey')" class="md:col-span-2">
        <UTextarea v-model="credentialForm.key" :rows="8" />
      </UFormField>
    </div>

    <div class="flex items-center gap-3">
      <CommonSaveButton
        :label="tLocal('saveCredential')"
        :loading="isSavingCredential"
        :disabled="isSavingCredential"
        @click="saveCredential" />
      <p v-if="statusMessage" class="text-sm text-muted">
        {{ statusMessage }}
      </p>
    </div>
  </section>
</template>
