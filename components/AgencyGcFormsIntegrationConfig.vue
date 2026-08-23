<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import {
  type GcsExtensionJsonConfig,
  type GcsResolvedExtension
} from '@gcs-ssc/extensions'
import {
  ExtensionButton,
  ExtensionCheckbox,
  ExtensionFormField,
  ExtensionInput,
  ExtensionRawTextarea,
  ExtensionSaveButton,
  ExtensionStatusSelect,
  useExtensionApi,
  useExtensionI18n
} from '@gcs-ssc/extensions/ui'
import {
  DEFAULT_GCFORMS_API_URL,
  DEFAULT_GCFORMS_IDP_URL,
  parseGcFormsAgencyConfig,
  type GcFormsCredentialSummary,
  type GcsGcFormsAgencyConfig
} from '../shared/gcforms'

const { agencyId, extension } = defineProps<{
  extension: GcsResolvedExtension
  agencyId: string
}>()

const config = defineModel<GcsExtensionJsonConfig>({ required: true })
const { locale } = useExtensionI18n()

const labels = {
  en: {
    connection: 'GC Forms instance',
    description: 'Set the trusted public HTTPS GC Forms API base URL for this agency.',
    apiUrl: 'API base URL',
    apiUrlHelp: 'HTTPS URL for the trusted public GC Forms API. Local and private-network endpoints are not allowed.',
    identityProviderUrl: 'Identity provider URL',
    identityProviderUrlHelp: 'Token issuer URL for the configured GC Forms instance.',
    confirmSubmissions: 'Confirm submissions after successful sync',
    submissionStatus: 'Imported claim status',
    submissionStatusHelp: 'The Agency Draft status assigned to claims materialized from GC Forms submissions.',
    defaultUrl: 'Hosted GC Forms default',
    credentials: 'Credentials',
    credentialsDescription: 'Store GC Forms private API keys for this agency. Private keys are encrypted and are never shown after saving.',
    nameEn: 'English name',
    nameFr: 'French name',
    name: 'Name',
    keyId: 'Key ID',
    userId: 'User ID',
    formId: 'Form ID',
    privateKey: 'Private key',
    privateKeyEditHelp: 'Leave blank to keep the saved private key.',
    updatedAt: 'Updated',
    actions: 'Actions',
    edit: 'Edit',
    newCredential: 'New credential',
    saveCredential: 'Save credential',
    saved: 'Credential saved.',
    deleted: 'Credential deleted.',
    failed: 'Credential action failed.',
    noCredentials: 'No credentials have been saved yet.',
    remove: 'Remove'
  },
  fr: {
    connection: 'Instance GC Forms',
    description: 'Définissez l’URL HTTPS publique de confiance de l’API GC Forms pour cette organisation.',
    apiUrl: 'URL de base de l’API',
    apiUrlHelp: 'URL HTTPS de l’API publique GC Forms de confiance. Les points de terminaison locaux et de réseau privé ne sont pas autorisés.',
    identityProviderUrl: 'URL du fournisseur d’identité',
    identityProviderUrlHelp: 'URL de l’émetteur de jetons pour l’instance GC Forms configurée.',
    confirmSubmissions: 'Confirmer les soumissions après une synchronisation réussie',
    submissionStatus: 'Statut des réclamations importées',
    submissionStatusHelp: 'Le statut Ébauche de l’organisation attribué aux réclamations matérialisées à partir des soumissions GC Forms.',
    defaultUrl: 'Valeur par défaut de GC Forms hébergé',
    credentials: 'Identifiants',
    credentialsDescription: 'Enregistrez les clés API privées GC Forms pour cette organisation. Les clés privées sont chiffrées et ne sont jamais affichées après l’enregistrement.',
    nameEn: 'Nom anglais',
    nameFr: 'Nom français',
    name: 'Nom',
    keyId: 'ID de la clé',
    userId: 'ID utilisateur',
    formId: 'ID du formulaire',
    privateKey: 'Clé privée',
    privateKeyEditHelp: 'Laissez vide pour conserver la clé privée enregistrée.',
    updatedAt: 'Mis à jour',
    actions: 'Actions',
    edit: 'Modifier',
    newCredential: 'Nouvel identifiant',
    saveCredential: 'Enregistrer l’identifiant',
    saved: 'Identifiant enregistré.',
    deleted: 'Identifiant supprimé.',
    failed: 'Échec de l’action sur l’identifiant.',
    noCredentials: 'Aucun identifiant n’a encore été enregistré.',
    remove: 'Supprimer'
  }
}

const tLocal = (key: keyof typeof labels.en) => locale.value === 'fr' ? labels.fr[key] : labels.en[key]

const localConfig: Ref<GcsGcFormsAgencyConfig> = ref(parseGcFormsAgencyConfig(config.value))
const credentials: Ref<GcFormsCredentialSummary[]> = ref([])
const credentialForm: Ref<Partial<{
  id: string
  name_en: string
  name_fr: string
  keyId: string
  userId: string
  formId: string
  key: string
}> | null> = ref(null)
const isLoadingCredentials: Ref<boolean> = ref(false)
const isSavingCredential: Ref<boolean> = ref(false)
const statusMessage: Ref<string> = ref('')

const hasSameAgencyConfig = (
  left: GcsGcFormsAgencyConfig,
  right: GcsGcFormsAgencyConfig
): boolean => left.apiUrl === right.apiUrl
  && left.identityProviderUrl === right.identityProviderUrl
  && left.confirmSubmissions === right.confirmSubmissions
  && left.submissionStatusId === right.submissionStatusId

watch(localConfig, value => {
  config.value = {
    apiUrl: value.apiUrl || null,
    identityProviderUrl: value.identityProviderUrl || null,
    confirmSubmissions: value.confirmSubmissions,
    submissionStatusId: value.submissionStatusId ?? null
  }
}, { deep: true })

watch(config, value => {
  const nextConfig = parseGcFormsAgencyConfig(value)
  if (!hasSameAgencyConfig(localConfig.value, nextConfig)) {
    localConfig.value = nextConfig
  }
})

const api = useExtensionApi(extension.key)
const credentialEndpoint = `/agencies/${agencyId}/credentials`

const refreshCredentials = async () => {
  try {
    isLoadingCredentials.value = true
    const payload = await api.get<{ items?: GcFormsCredentialSummary[] }>(credentialEndpoint)
    credentials.value = payload.items ?? []
  } catch {
    credentials.value = []
  } finally {
    isLoadingCredentials.value = false
  }
}

const newCredential = () => {
  credentialForm.value = {}
}

const editCredential = (credential: GcFormsCredentialSummary) => {
  credentialForm.value = {
    id: credential.id,
    name_en: credential.name_en,
    name_fr: credential.name_fr,
    keyId: credential.keyId,
    userId: credential.userId,
    formId: credential.formId,
    key: ''
  }
}

/** Creates or updates the credential being edited, then refreshes the agency credential list. */
const saveCredential = async () => {
  const form = credentialForm.value
  if (!form) {
    return
  }

  try {
    isSavingCredential.value = true
    statusMessage.value = ''
    const body = Object.fromEntries(Object.entries(form).filter(([, value]) => value !== ''))
    if (form.id) {
      await api.patch(`${credentialEndpoint}/${encodeURIComponent(form.id)}`, body)
    } else {
      await api.post(credentialEndpoint, form)
    }
    credentialForm.value = null
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
    await api.delete(`${credentialEndpoint}/${encodeURIComponent(credentialId)}`)
    statusMessage.value = tLocal('deleted')
    await refreshCredentials()
  } catch {
    statusMessage.value = tLocal('failed')
  }
}

const displayName = (credential: GcFormsCredentialSummary): string =>
  locale.value === 'fr' ? credential.name_fr : credential.name_en

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
      <ExtensionFormField :label="tLocal('apiUrl')" :description="tLocal('apiUrlHelp')">
        <ExtensionInput v-model="localConfig.apiUrl" :placeholder="DEFAULT_GCFORMS_API_URL" />
      </ExtensionFormField>
      <ExtensionFormField :label="tLocal('identityProviderUrl')" :description="tLocal('identityProviderUrlHelp')">
        <ExtensionInput v-model="localConfig.identityProviderUrl" :placeholder="DEFAULT_GCFORMS_IDP_URL" />
      </ExtensionFormField>
      <div class="md:col-span-2">
        <ExtensionFormField
          required
          :label="tLocal('submissionStatus')"
          :description="tLocal('submissionStatusHelp')">
          <ExtensionStatusSelect
            v-model="localConfig.submissionStatusId"
            :agency-id="agencyId"
            :draft-only="true" />
        </ExtensionFormField>
      </div>
      <div class="md:col-span-2">
        <ExtensionCheckbox
          v-model="localConfig.confirmSubmissions"
          :label="tLocal('confirmSubmissions')" />
      </div>
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
    <ExtensionButton
      icon="i-lucide-plus"
      color="primary"
      variant="outline"
      class="cursor-default"
      :label="tLocal('newCredential')"
      @click="newCredential" />

    <div v-if="credentials.length === 0 && !isLoadingCredentials" class="text-sm text-muted">
      {{ tLocal('noCredentials') }}
    </div>
    <div v-else class="overflow-hidden border-y border-default">
      <table class="w-full text-left text-sm">
        <thead class="bg-muted/40 text-muted">
          <tr>
            <th class="px-3 py-2 font-medium">
              {{ tLocal('name') }}
            </th>
            <th class="px-3 py-2 font-medium">
              {{ tLocal('formId') }}
            </th>
            <th class="px-3 py-2 font-medium">
              {{ tLocal('keyId') }}
            </th>
            <th class="px-3 py-2 font-medium">
              {{ tLocal('userId') }}
            </th>
            <th class="px-3 py-2 font-medium">
              {{ tLocal('updatedAt') }}
            </th>
            <th class="px-3 py-2 font-medium">
              {{ tLocal('actions') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="credential in credentials" :key="credential.id" class="border-t border-default">
            <td class="px-3 py-2 font-medium">
              {{ displayName(credential) }}
            </td>
            <td class="px-3 py-2">
              {{ credential.formId }}
            </td>
            <td class="px-3 py-2">
              {{ credential.keyId }}
            </td>
            <td class="px-3 py-2">
              {{ credential.userId }}
            </td>
            <td class="px-3 py-2">
              {{ credential.updatedAt ?? '-' }}
            </td>
            <td class="px-3 py-2">
              <div class="flex items-center gap-1">
                <ExtensionButton
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  class="cursor-default"
                  :aria-label="tLocal('edit')"
                  @click="editCredential(credential)" />
                <ExtensionButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="sm"
                  class="cursor-default"
                  :aria-label="tLocal('remove')"
                  @click="deleteCredential(credential.id)" />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="credentialForm" class="grid gap-4 md:grid-cols-2">
      <ExtensionFormField :label="tLocal('nameEn')">
        <ExtensionInput v-model="credentialForm.name_en" />
      </ExtensionFormField>
      <ExtensionFormField :label="tLocal('nameFr')">
        <ExtensionInput v-model="credentialForm.name_fr" />
      </ExtensionFormField>
      <ExtensionFormField :label="tLocal('keyId')">
        <ExtensionInput v-model="credentialForm.keyId" />
      </ExtensionFormField>
      <ExtensionFormField :label="tLocal('userId')">
        <ExtensionInput v-model="credentialForm.userId" />
      </ExtensionFormField>
      <ExtensionFormField :label="tLocal('formId')">
        <ExtensionInput v-model="credentialForm.formId" />
      </ExtensionFormField>
      <ExtensionFormField
        :label="tLocal('privateKey')"
        :description="credentialForm.id ? tLocal('privateKeyEditHelp') : undefined"
        class="md:col-span-2">
        <ExtensionRawTextarea v-model="credentialForm.key" :rows="8" />
      </ExtensionFormField>
    </div>

    <div v-if="credentialForm" class="flex items-center gap-3">
      <ExtensionSaveButton
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
