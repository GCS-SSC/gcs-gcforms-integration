import { defineGcsExtension, defineGcsAuditOwnership } from '@gcs-ssc/extensions'

export default defineGcsExtension({
  // Host-managed configuration, KV and secrets keep their host ownership rules.
  auditOwnership: defineGcsAuditOwnership([
    {
      table: 'extensions.gcs_gcforms_integration_credentials',
      owner: {
        kind: 'owner',
        owner: 'agency',
        column: 'agency_id'
      }
    },
    {
      table: 'extensions.gcs_gcforms_integration_connections',
      owner: {
        kind: 'owner',
        owner: 'stream',
        column: 'stream_id'
      }
    },
    {
      table: 'extensions.gcs_gcforms_integration_integrations',
      owner: {
        kind: 'owner',
        owner: 'stream',
        column: 'stream_id'
      }
    },
    {
      table: 'extensions.gcs_gcforms_integration_templates',
      owner: {
        kind: 'parent',
        table: 'extensions.gcs_gcforms_integration_connections',
        column: 'connection_id'
      }
    },
    {
      table: 'extensions.gcs_gcforms_integration_field_mappings',
      owner: {
        kind: 'parent',
        table: 'extensions.gcs_gcforms_integration_integrations',
        column: 'integration_id'
      }
    },
    {
      table: 'extensions.gcs_gcforms_integration_submissions',
      owner: {
        kind: 'parent',
        table: 'extensions.gcs_gcforms_integration_connections',
        column: 'connection_id'
      }
    },
    {
      table: 'extensions.gcs_gcforms_integration_attachments',
      owner: {
        kind: 'parent',
        table: 'extensions.gcs_gcforms_integration_submissions',
        column: 'submission_id'
      }
    },
    {
      table: 'extensions.gcs_gcforms_integration_import_runs',
      owner: {
        kind: 'parent',
        table: 'extensions.gcs_gcforms_integration_connections',
        column: 'connection_id'
      }
    },
    {
      table: 'extensions.gcs_gcforms_integration_destination_links',
      owner: {
        kind: 'parent',
        table: 'extensions.gcs_gcforms_integration_submissions',
        column: 'submission_id'
      }
    },
    {
      table: 'extensions.gcs_gcforms_integration_materialization_overrides',
      owner: {
        kind: 'parent',
        table: 'extensions.gcs_gcforms_integration_submissions',
        column: 'submission_id'
      }
    }
  ]),
  key: 'gcs-gcforms-integration',
  sdkVersion: '^0.3.2',
  requiredHostCapabilities: [
    'audit-ownership',
    'agency-config',
    'stream-config-modal',
    'stream-config-page',
    'entity-tabs',
    'server-handlers',
    'server-handler-rbac',
    'migrations',
    'runtime-resolution',
    'extension-ui',
    'extension-api-client',
    'host-api-client',
    'extension-secrets',
    'extension-lifecycle-hooks'
  ],
  name: {
    en: 'GC Forms integration',
    fr: 'Intégration de Formulaires GC'
  },
  description: {
    en: 'Connects GC Forms templates, submissions, and attachments to configurable GCS field mappings.',
    fr: 'Connecte les modèles, les soumissions et les pièces jointes Formulaires GC à des correspondances configurables de champs GCS.'
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
        target: 'proponent',
        id: 'gcforms-source',
        label: {
          en: 'GC Forms',
          fr: 'Formulaires GC'
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
          fr: 'Formulaires GC'
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
          fr: 'Formulaires GC'
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
    },
    {
      path: './server/migrations/0003_credential_identity_upgrade.ts'
    }
  ],
  nitroPlugin: './server/plugins/lifecycle-guards.ts',
  serverHandlers: [
    {
      route: '/agencies/[agencyId]/credentials',
      method: 'get',
      rbac: {
        subject: 'agency',
        action: 'read',
        agency: { param: 'agencyId' }
      },
      path: './server/api/agency-credentials.get.ts'
    },
    {
      route: '/agencies/[agencyId]/credentials',
      method: 'post',
      rbac: {
        subject: 'agency',
        action: 'update',
        agency: { param: 'agencyId' }
      },
      path: './server/api/agency-credentials.post.ts'
    },
    {
      route: '/agencies/[agencyId]/credentials/[credentialId]',
      method: 'patch',
      rbac: {
        subject: 'agency',
        action: 'update',
        agency: { param: 'agencyId' }
      },
      path: './server/api/agency-credentials.patch.ts'
    },
    {
      route: '/agencies/[agencyId]/credentials/[credentialId]',
      method: 'delete',
      rbac: {
        subject: 'agency',
        action: 'update',
        agency: { param: 'agencyId' }
      },
      path: './server/api/agency-credentials.delete.ts'
    },
    {
      route: '/streams/[streamId]/template',
      method: 'get',
      rbac: {
        subject: 'transfer_payment',
        action: 'read',
        stream: { param: 'streamId' }
      },
      path: './server/api/template.get.ts'
    },
    {
      route: '/streams/[streamId]/claim-template',
      method: 'get',
      rbac: {
        subject: 'transfer_payment',
        action: 'read',
        stream: { param: 'streamId' }
      },
      path: './server/api/claim-template.get.ts'
    },
    {
      route: '/streams/[streamId]/template',
      method: 'post',
      rbac: {
        subject: 'transfer_payment',
        action: 'update',
        stream: { param: 'streamId' }
      },
      path: './server/api/template.post.ts'
    },
    {
      route: '/streams/[streamId]/submissions',
      method: 'get',
      rbac: {
        subject: 'transfer_payment',
        action: 'read',
        stream: { param: 'streamId' }
      },
      path: './server/api/submissions.get.ts'
    },
    {
      route: '/streams/[streamId]/materialization-failures',
      method: 'get',
      rbac: {
        subject: 'transfer_payment',
        action: 'read',
        stream: { param: 'streamId' }
      },
      path: './server/api/materialization-failures.get.ts'
    },
    {
      route: '/streams/[streamId]/materialization-failures/[submissionId]/agreement',
      method: 'post',
      rbac: {
        subject: 'transfer_payment',
        action: 'update',
        stream: { param: 'streamId' }
      },
      path: './server/api/materialization-failure-agreement.post.ts'
    },
    {
      route: '/streams/[streamId]/sync',
      method: 'post',
      rbac: {
        subject: 'transfer_payment',
        action: 'update',
        stream: { param: 'streamId' }
      },
      path: './server/api/sync.post.ts'
    },
    {
      route: '/streams/[streamId]/preview',
      method: 'post',
      rbac: {
        subject: 'transfer_payment',
        action: 'read',
        stream: { param: 'streamId' }
      },
      path: './server/api/preview.post.ts'
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
