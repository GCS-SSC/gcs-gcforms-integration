<script setup lang="ts">
/* eslint-disable jsdoc/require-jsdoc */
import { computed, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { nanoid } from 'nanoid'
import type { GcsExtensionJsonConfig, GcsResolvedExtension, JsonValue } from '@gcs-ssc/extensions'
import {
  DEFAULT_GCFORMS_IDP_URL,
  DEFAULT_GCFORMS_PROJECT_IDENTIFIER,
  GcsDestinationEntitySchema,
  GcsGcFormsTransformSchema,
  parseGcFormsStreamConfig,
  type GcFormsCredentialSummary,
  type GcFormsFieldCatalogItem,
  type GcsDestinationEntity,
  type GcsGcFormsFieldMapping,
  type GcsGcFormsStreamConfig,
  type GcsGcFormsTransform
} from '../shared/gcforms'

const {
  streamId,
  agencyId
} = defineProps<{
  extension: GcsResolvedExtension
  streamId: string
  transferPaymentId?: string
  agencyId?: string
}>()

const config = defineModel<GcsExtensionJsonConfig>({ required: true })
const { locale } = useI18n()

const labels = {
  en: {
    connection: 'Connection',
    credentialId: 'Credential ID',
    formId: 'Form ID',
    identityProviderUrl: 'Identity provider URL',
    projectIdentifier: 'Project identifier',
    contactEmail: 'Support contact email',
    preferredLanguage: 'Support language',
    confirmSubmissions: 'Confirm submissions after successful sync',
    template: 'Form fields',
    refreshTemplate: 'Refresh template',
    sync: 'Sync submissions',
    mappings: 'Mappings',
    failedMaterializations: 'Failed materializations',
    noFailedMaterializations: 'No failed claim materializations need review.',
    refreshFailures: 'Refresh failures',
    submission: 'Submission',
    formAgreement: 'Form agreement',
    gcsAgreement: 'GCS agreement',
    match: 'Match',
    addMapping: 'Add mapping',
    source: 'GC Forms field',
    destinationEntity: 'GCS destination',
    destinationPath: 'Destination path',
    transform: 'Transform',
    required: 'Required',
    actions: 'Actions',
    noFields: 'Refresh the template to inspect form fields.',
    noMappings: 'Add mappings to preview how GC Forms answers will land in GCS.',
    savedByHost: 'Changes are saved with the stream extension configuration.',
    remove: 'Remove mapping',
    loading: 'Loading',
    success: 'Completed',
    failed: 'Action failed',
    type: 'Type',
    id: 'ID'
  },
  fr: {
    connection: 'Connexion',
    credentialId: 'ID du justificatif',
    formId: 'ID du formulaire',
    identityProviderUrl: 'URL du fournisseur d identite',
    projectIdentifier: 'Identifiant du projet',
    contactEmail: 'Courriel de soutien',
    preferredLanguage: 'Langue de soutien',
    confirmSubmissions: 'Confirmer les soumissions apres une synchronisation reussie',
    template: 'Champs du formulaire',
    refreshTemplate: 'Actualiser le modele',
    sync: 'Synchroniser les soumissions',
    mappings: 'Correspondances',
    failedMaterializations: 'Materialisations echouees',
    noFailedMaterializations: 'Aucune materialisation de reclamation echouee ne necessite de verification.',
    refreshFailures: 'Actualiser les echecs',
    submission: 'Soumission',
    formAgreement: 'Entente du formulaire',
    gcsAgreement: 'Entente GCS',
    match: 'Associer',
    addMapping: 'Ajouter une correspondance',
    source: 'Champ GC Forms',
    destinationEntity: 'Destination GCS',
    destinationPath: 'Chemin de destination',
    transform: 'Transformation',
    required: 'Obligatoire',
    actions: 'Actions',
    noFields: 'Actualisez le modele pour inspecter les champs du formulaire.',
    noMappings: 'Ajoutez des correspondances pour previsualiser les reponses GC Forms dans GCS.',
    savedByHost: 'Les changements sont enregistres avec la configuration du volet.',
    remove: 'Supprimer la correspondance',
    loading: 'Chargement',
    success: 'Termine',
    failed: 'Echec de l action',
    type: 'Type',
    id: 'ID'
  }
}

const tLocal = (key: keyof typeof labels.en) => locale.value === 'fr' ? labels.fr[key] : labels.en[key]
const isFrench = computed(() => locale.value === 'fr')

const localConfig: Ref<GcsGcFormsStreamConfig> = ref(parseGcFormsStreamConfig(config.value))
const fieldCatalog: Ref<GcFormsFieldCatalogItem[]> = ref([])
const credentials: Ref<GcFormsCredentialSummary[]> = ref([])
const isRefreshingTemplate: Ref<boolean> = ref(false)
const isSyncing: Ref<boolean> = ref(false)
const isLoadingMaterializationFailures: Ref<boolean> = ref(false)
const resolvingSubmissionId: Ref<string | null> = ref(null)
const statusMessage: Ref<string> = ref('')
const failedMaterializations: Ref<GcFormsMaterializationFailureItem[]> = ref([])
const agreementOptions: Ref<GcFormsAgreementOption[]> = ref([])
const selectedAgreements: Ref<Record<string, string>> = ref({})

interface GcFormsAgreementOption {
  id: string
  agreementNumber: string
  label: string
}

interface GcFormsMaterializationFailureItem {
  submissionId: string
  submissionName: string
  agreementNumber: string | null
  selectedAgreementId: string | null
  lastError: string | null
}

watch(localConfig, value => {
  config.value = {
    credentialId: value.credentialId ?? null,
    formId: value.formId ?? null,
    identityProviderUrl: value.identityProviderUrl ?? null,
    projectIdentifier: value.projectIdentifier ?? null,
    contactEmail: value.contactEmail ?? null,
    preferredLanguage: value.preferredLanguage,
    confirmSubmissions: value.confirmSubmissions,
    mappings: value.mappings as unknown as JsonValue
  }
}, { deep: true })

watch(config, value => {
  localConfig.value = parseGcFormsStreamConfig(value)
})

const languageOptions = computed(() => [
  { label: 'English', value: 'en' },
  { label: 'Francais', value: 'fr' }
])

const credentialOptions = computed(() => {
  const items = credentials.value.map(credential => ({
    label: credential.credentialId,
    value: credential.credentialId
  }))
  const selected = localConfig.value.credentialId
  if (selected && !items.some(item => item.value === selected)) {
    items.unshift({
      label: selected,
      value: selected
    })
  }

  return items
})

const destinationOptions = computed(() => GcsDestinationEntitySchema.options.map(value => ({
  label: value,
  value
})))

const transformOptions = computed(() => GcsGcFormsTransformSchema.options.map(value => ({
  label: value,
  value
})))

const sourceOptions = computed(() => fieldCatalog.value.map(field => ({
  label: locale.value === 'fr' ? field.label_fr : field.label_en,
  value: field.questionId
})))

const agreementSelectOptions = computed(() => agreementOptions.value.map(agreement => ({
  label: agreement.label,
  value: agreement.id
})))

const mappingRows = computed(() => localConfig.value.mappings)

const addMapping = () => {
  localConfig.value.mappings.push({
    id: nanoid(),
    sourceQuestionId: fieldCatalog.value[0]?.questionId ?? '',
    destinationEntity: 'source_record',
    destinationPath: 'payload',
    transform: 'string',
    required: false,
    onMissing: 'skip',
    onInvalid: 'block'
  })
}

const removeMapping = (id: string) => {
  localConfig.value.mappings = localConfig.value.mappings.filter(mapping => mapping.id !== id)
}

const setMappingValue = <K extends keyof GcsGcFormsFieldMapping>(
  mapping: GcsGcFormsFieldMapping,
  key: K,
  value: GcsGcFormsFieldMapping[K]
) => {
  mapping[key] = value
}

const postJson = async (path: string, body?: unknown): Promise<unknown> => {
  const response = await fetch(`/api/extensions/gcs-gcforms-integration${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })

  if (!response.ok) {
    throw new Error(tLocal('failed'))
  }

  return await response.json() as unknown
}

const getJson = async (path: string): Promise<unknown> => {
  const response = await fetch(`/api/extensions/gcs-gcforms-integration${path}`)

  if (!response.ok) {
    throw new Error(tLocal('failed'))
  }

  return await response.json() as unknown
}

const setSelectedAgreement = (submissionId: string, agreementId: unknown) => {
  if (agreementId === null || agreementId === undefined || String(agreementId).trim().length === 0) {
    const next = { ...selectedAgreements.value }
    delete next[submissionId]
    selectedAgreements.value = next
    return
  }

  selectedAgreements.value = {
    ...selectedAgreements.value,
    [submissionId]: String(agreementId)
  }
}

const refreshCredentials = async () => {
  if (!agencyId) {
    credentials.value = []
    return
  }

  const response = await fetch(`/api/extensions/gcs-gcforms-integration/agencies/${agencyId}/credentials`)
  if (!response.ok) {
    credentials.value = []
    return
  }
  const payload = await response.json() as { items?: GcFormsCredentialSummary[] }
  credentials.value = payload.items ?? []
}

const refreshTemplate = async () => {
  try {
    isRefreshingTemplate.value = true
    statusMessage.value = tLocal('loading')
    const response = await postJson(`/streams/${streamId}/template`) as { fieldCatalog: GcFormsFieldCatalogItem[] }
    fieldCatalog.value = response.fieldCatalog
    statusMessage.value = tLocal('success')
  } catch {
    statusMessage.value = tLocal('failed')
  } finally {
    isRefreshingTemplate.value = false
  }
}

const syncSubmissions = async () => {
  try {
    isSyncing.value = true
    statusMessage.value = tLocal('loading')
    await postJson(`/streams/${streamId}/sync`)
    await refreshMaterializationFailures()
    statusMessage.value = tLocal('success')
  } catch {
    statusMessage.value = tLocal('failed')
  } finally {
    isSyncing.value = false
  }
}

const refreshMaterializationFailures = async () => {
  try {
    isLoadingMaterializationFailures.value = true
    const response = await getJson(`/streams/${streamId}/materialization-failures`) as {
      items?: GcFormsMaterializationFailureItem[]
      agreements?: GcFormsAgreementOption[]
    }
    failedMaterializations.value = response.items ?? []
    agreementOptions.value = response.agreements ?? []
    selectedAgreements.value = failedMaterializations.value.reduce<Record<string, string>>((accumulator, item) => {
      if (item.selectedAgreementId) {
        accumulator[item.submissionId] = item.selectedAgreementId
      }
      return accumulator
    }, {})
  } catch {
    failedMaterializations.value = []
    agreementOptions.value = []
  } finally {
    isLoadingMaterializationFailures.value = false
  }
}

const resolveMaterializationFailure = async (submission: GcFormsMaterializationFailureItem) => {
  const agreementId = selectedAgreements.value[submission.submissionId]
  if (!agreementId) {
    return
  }

  try {
    resolvingSubmissionId.value = submission.submissionId
    statusMessage.value = tLocal('loading')
    await postJson(`/streams/${streamId}/materialization-failures/${submission.submissionId}/agreement`, { agreementId })
    await refreshMaterializationFailures()
    statusMessage.value = tLocal('success')
  } catch {
    statusMessage.value = tLocal('failed')
  } finally {
    resolvingSubmissionId.value = null
  }
}

onMounted(async () => {
  await refreshCredentials()
  await refreshMaterializationFailures()
})
</script>

<template>
  <div class="space-y-8">
    <section class="space-y-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="text-base font-semibold text-highlighted">
            {{ tLocal('connection') }}
          </h3>
          <p class="mt-1 text-sm text-muted">
            {{ tLocal('savedByHost') }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            class="cursor-default"
            :label="tLocal('refreshTemplate')"
            :loading="isRefreshingTemplate"
            @click="refreshTemplate" />
          <UButton
            icon="i-lucide-download"
            color="primary"
            variant="solid"
            class="cursor-default"
            :label="tLocal('sync')"
            :loading="isSyncing"
            @click="syncSubmissions" />
        </div>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <UFormField :label="tLocal('credentialId')">
          <USelect v-model="localConfig.credentialId" :items="credentialOptions" />
        </UFormField>
        <UFormField :label="tLocal('formId')">
          <UInput v-model="localConfig.formId" />
        </UFormField>
        <UFormField :label="tLocal('identityProviderUrl')">
          <UInput v-model="localConfig.identityProviderUrl" :placeholder="DEFAULT_GCFORMS_IDP_URL" />
        </UFormField>
        <UFormField :label="tLocal('projectIdentifier')">
          <UInput v-model="localConfig.projectIdentifier" :placeholder="DEFAULT_GCFORMS_PROJECT_IDENTIFIER" />
        </UFormField>
        <UFormField :label="tLocal('preferredLanguage')">
          <USelect v-model="localConfig.preferredLanguage" :items="languageOptions" />
        </UFormField>
        <UFormField :label="tLocal('contactEmail')" class="md:col-span-2">
          <UInput v-model="localConfig.contactEmail" type="email" />
        </UFormField>
        <div class="md:col-span-2">
          <UCheckbox
            v-model="localConfig.confirmSubmissions"
            :label="tLocal('confirmSubmissions')" />
        </div>
      </div>
      <p v-if="statusMessage" class="text-sm text-muted">
        {{ statusMessage }}
      </p>
    </section>

    <section class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h3 class="text-base font-semibold text-highlighted">
          {{ tLocal('failedMaterializations') }}
        </h3>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          class="cursor-default"
          :label="tLocal('refreshFailures')"
          :loading="isLoadingMaterializationFailures"
          @click="refreshMaterializationFailures" />
      </div>
      <div v-if="failedMaterializations.length === 0" class="text-sm text-muted">
        {{ tLocal('noFailedMaterializations') }}
      </div>
      <div v-else class="overflow-hidden border-y border-default">
        <table class="w-full text-left text-sm">
          <thead class="bg-muted/40 text-muted">
            <tr>
              <th class="px-3 py-2 font-medium">
                {{ tLocal('submission') }}
              </th>
              <th class="px-3 py-2 font-medium">
                {{ tLocal('formAgreement') }}
              </th>
              <th class="px-3 py-2 font-medium">
                {{ tLocal('gcsAgreement') }}
              </th>
              <th class="px-3 py-2 font-medium">
                {{ tLocal('actions') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="submission in failedMaterializations"
              :key="submission.submissionId"
              class="border-t border-default align-top">
              <td class="px-3 py-2">
                <div class="font-medium text-highlighted">
                  {{ submission.submissionName }}
                </div>
                <div v-if="submission.lastError" class="mt-1 text-xs text-muted">
                  {{ submission.lastError }}
                </div>
              </td>
              <td class="px-3 py-2 font-mono text-xs text-muted">
                {{ submission.agreementNumber ?? '-' }}
              </td>
              <td class="px-3 py-2">
                <USelect
                  :model-value="selectedAgreements[submission.submissionId]"
                  :items="agreementSelectOptions"
                  @update:model-value="(value: unknown) => setSelectedAgreement(submission.submissionId, value)" />
              </td>
              <td class="px-3 py-2">
                <UButton
                  icon="i-lucide-link"
                  color="primary"
                  variant="solid"
                  class="cursor-default"
                  :label="tLocal('match')"
                  :disabled="!selectedAgreements[submission.submissionId]"
                  :loading="resolvingSubmissionId === submission.submissionId"
                  @click="resolveMaterializationFailure(submission)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="space-y-4">
      <div>
        <h3 class="text-base font-semibold text-highlighted">
          {{ tLocal('template') }}
        </h3>
      </div>
      <div v-if="fieldCatalog.length === 0" class="text-sm text-muted">
        {{ tLocal('noFields') }}
      </div>
      <div v-else class="overflow-hidden border-y border-default">
        <table class="w-full text-left text-sm">
          <thead class="bg-muted/40 text-muted">
            <tr>
              <th class="px-3 py-2 font-medium">
                {{ tLocal('source') }}
              </th>
              <th class="px-3 py-2 font-medium">
                {{ tLocal('type') }}
              </th>
              <th class="px-3 py-2 font-medium">
                {{ tLocal('id') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="field in fieldCatalog" :key="field.questionId" class="border-t border-default">
              <td class="px-3 py-2">
                {{ isFrench ? field.label_fr : field.label_en }}
              </td>
              <td class="px-3 py-2 text-muted">
                {{ field.type }}
              </td>
              <td class="px-3 py-2 font-mono text-xs text-muted">
                {{ field.questionId }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="space-y-4">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-base font-semibold text-highlighted">
          {{ tLocal('mappings') }}
        </h3>
        <UButton
          icon="i-lucide-plus"
          color="neutral"
          variant="outline"
          class="cursor-default"
          :label="tLocal('addMapping')"
          @click="addMapping" />
      </div>

      <div v-if="mappingRows.length === 0" class="text-sm text-muted">
        {{ tLocal('noMappings') }}
      </div>
      <div v-else class="space-y-3">
        <div
          v-for="mapping in mappingRows"
          :key="mapping.id"
          class="grid gap-3 border-y border-default py-3 lg:grid-cols-[1.2fr_1fr_1.2fr_.9fr_auto]">
          <UFormField :label="tLocal('source')">
            <USelect
              :model-value="mapping.sourceQuestionId"
              :items="sourceOptions"
              @update:model-value="(value: unknown) => setMappingValue(mapping, 'sourceQuestionId', String(value))" />
          </UFormField>
          <UFormField :label="tLocal('destinationEntity')">
            <USelect
              :model-value="mapping.destinationEntity"
              :items="destinationOptions"
              @update:model-value="(value: unknown) => setMappingValue(mapping, 'destinationEntity', value as GcsDestinationEntity)" />
          </UFormField>
          <UFormField :label="tLocal('destinationPath')">
            <UInput
              :model-value="mapping.destinationPath"
              @update:model-value="(value: unknown) => setMappingValue(mapping, 'destinationPath', String(value))" />
          </UFormField>
          <UFormField :label="tLocal('transform')">
            <USelect
              :model-value="mapping.transform"
              :items="transformOptions"
              @update:model-value="(value: unknown) => setMappingValue(mapping, 'transform', value as GcsGcFormsTransform)" />
          </UFormField>
          <div class="flex items-end gap-2">
            <UCheckbox
              :model-value="mapping.required"
              :label="tLocal('required')"
              @update:model-value="(value: unknown) => setMappingValue(mapping, 'required', value === true)" />
            <UTooltip :text="tLocal('remove')">
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                class="cursor-default"
                :aria-label="tLocal('remove')"
                @click="removeMapping(mapping.id)" />
            </UTooltip>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
