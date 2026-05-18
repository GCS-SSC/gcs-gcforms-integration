import { defineGcsExtension } from '@gcs-ssc/extensions'

export default defineGcsExtension({
  key: 'gcs-gcforms-integration',
  name: {
    en: 'GC Forms integration',
    fr: 'Integration GC Forms'
  },
  description: {
    en: 'Connects GC Forms templates, submissions, and attachments to configurable GCS field mappings.',
    fr: 'Connecte les modeles, les soumissions et les pieces jointes GC Forms a des correspondances configurables de champs GCS.'
  },
  admin: {
    agency: {
      path: './components/AgencyGcFormsIntegrationConfig.vue'
    },
    streamConfig: {
      path: './components/StreamGcFormsIntegrationConfig.vue'
    },
    streamConfigPage: {
      path: './components/StreamGcFormsIntegrationConfig.vue'
    }
  },
  client: {
    tabs: [
      {
        target: 'agreement',
        id: 'gcforms-source',
        label: {
          en: 'GC Forms',
          fr: 'GC Forms'
        },
        icon: 'i-lucide-file-input',
        path: './components/GcFormsEntitySourceTab.vue',
        rbac: {
          subject: 'agreement',
          action: 'read'
        }
      },
      {
        target: 'proponent',
        id: 'gcforms-source',
        label: {
          en: 'GC Forms',
          fr: 'GC Forms'
        },
        icon: 'i-lucide-file-input',
        path: './components/GcFormsEntitySourceTab.vue',
        rbac: {
          subject: 'applicant_recipient',
          action: 'read'
        }
      },
      {
        target: 'claim',
        id: 'gcforms-source',
        label: {
          en: 'GC Forms',
          fr: 'GC Forms'
        },
        icon: 'i-lucide-file-input',
        path: './components/GcFormsEntitySourceTab.vue',
        rbac: {
          subject: 'agreement',
          action: 'read'
        }
      },
      {
        target: 'monitor',
        id: 'gcforms-source',
        label: {
          en: 'GC Forms',
          fr: 'GC Forms'
        },
        icon: 'i-lucide-file-input',
        path: './components/GcFormsEntitySourceTab.vue',
        rbac: {
          subject: 'agreement',
          action: 'read'
        }
      }
    ]
  },
  migrations: [
    {
      path: './server/migrations/0001_gcforms_integration.ts'
    },
    {
      path: './server/migrations/0002_claim_submission_uuid.ts'
    }
  ],
  serverHandlers: [
    {
      route: '/agencies/[agencyId]/credentials',
      method: 'get',
      path: './server/api/agency-credentials.get.ts'
    },
    {
      route: '/agencies/[agencyId]/credentials',
      method: 'post',
      path: './server/api/agency-credentials.post.ts'
    },
    {
      route: '/agencies/[agencyId]/credentials/[credentialId]',
      method: 'delete',
      path: './server/api/agency-credentials.delete.ts'
    },
    {
      route: '/streams/[streamId]/template',
      method: 'get',
      path: './server/api/template.get.ts'
    },
    {
      route: '/streams/[streamId]/template',
      method: 'post',
      path: './server/api/template.post.ts'
    },
    {
      route: '/streams/[streamId]/submissions',
      method: 'get',
      path: './server/api/submissions.get.ts'
    },
    {
      route: '/streams/[streamId]/materialization-failures',
      method: 'get',
      path: './server/api/materialization-failures.get.ts'
    },
    {
      route: '/streams/[streamId]/materialization-failures/[submissionId]/agreement',
      method: 'post',
      path: './server/api/materialization-failure-agreement.post.ts'
    },
    {
      route: '/streams/[streamId]/sync',
      method: 'post',
      path: './server/api/sync.post.ts'
    },
    {
      route: '/streams/[streamId]/preview',
      method: 'post',
      path: './server/api/preview.post.ts'
    },
    {
      route: '/agreements/[agreementId]/submissions',
      method: 'get',
      path: './server/api/entity-submissions.get.ts',
      rbac: {
        subject: 'agreement',
        action: 'read',
        entity: {
          target: 'agreement',
          param: 'agreementId'
        }
      }
    },
    {
      route: '/proponents/[applicantRecipientId]/submissions',
      method: 'get',
      path: './server/api/entity-submissions.get.ts',
      rbac: {
        subject: 'applicant_recipient',
        action: 'read',
        entity: {
          target: 'proponent',
          param: 'applicantRecipientId'
        }
      }
    },
    {
      route: '/claims/[claimId]/submissions',
      method: 'get',
      path: './server/api/entity-submissions.get.ts',
      rbac: {
        subject: 'agreement',
        action: 'read',
        entity: {
          target: 'claim',
          param: 'claimId'
        }
      }
    },
    {
      route: '/monitors/[monitorId]/submissions',
      method: 'get',
      path: './server/api/entity-submissions.get.ts',
      rbac: {
        subject: 'agreement',
        action: 'read',
        entity: {
          target: 'monitor',
          param: 'monitorId'
        }
      }
    }
  ]
})
