import extension from '../../extension.config'
// Integration adapter from the host tooling checkout; production code uses only the SDK.
const { verifyExtensionAuditContract } = await import(new URL(
  '../../../../tooling/gcs-ssc/tests/fixtures/extension-audit-contract.ts', import.meta.url
).href)

verifyExtensionAuditContract(extension, [
  {
    'table': 'extensions.gcs_gcforms_credentials',
    'row': {
      'id': '1',
      'agency_id': '11'
    },
    'agencies': [
      '11'
    ]
  },
  {
    'table': 'extensions.gcs_gcforms_connections',
    'row': {
      'id': '2',
      'agency_id': '11',
      'stream_id': '201'
    },
    'agencies': [
      '11'
    ]
  },
  {
    'table': 'extensions.gcs_gcforms_integrations',
    'row': {
      'id': '3',
      'connection_id': '2',
      'stream_id': '201'
    },
    'agencies': [
      '11'
    ]
  },
  {
    'table': 'extensions.gcs_gcforms_templates',
    'row': {
      'id': '4',
      'connection_id': '2'
    },
    'agencies': [
      '11'
    ]
  },
  {
    'table': 'extensions.gcs_gcforms_field_mappings',
    'row': {
      'id': '5',
      'integration_id': '3'
    },
    'agencies': [
      '11'
    ]
  },
  {
    'table': 'extensions.gcs_gcforms_submissions',
    'row': {
      'id': '6',
      'connection_id': '2'
    },
    'agencies': [
      '11'
    ]
  },
  {
    'table': 'extensions.gcs_gcforms_attachments',
    'row': {
      'id': '7',
      'submission_id': '6'
    },
    'agencies': [
      '11'
    ]
  },
  {
    'table': 'extensions.gcs_gcforms_import_runs',
    'row': {
      'id': '8',
      'connection_id': '2'
    },
    'agencies': [
      '11'
    ]
  },
  {
    'table': 'extensions.gcs_gcforms_destination_links',
    'row': {
      'id': '9',
      'submission_id': '6',
      'owner_type': 'applicantrecipient',
      'owner_id': '601'
    },
    'agencies': [
      '11'
    ]
  },
  {
    'table': 'extensions.gcs_gcforms_materialization_overrides',
    'row': {
      'id': '10',
      'submission_id': '6',
      'owner_type': 'applicantrecipient',
      'owner_id': '601'
    },
    'agencies': [
      '11'
    ]
  },
  {
    'table': 'extensions.agency_enablement',
    'row': {
      'id': '90',
      'agency_id': '11',
      'extension_key': 'gcs-gcforms-integration'
    },
    'agencies': [
      '11'
    ]
  },
  {
    'table': 'extensions.stream_configuration',
    'row': {
      'id': '91',
      'stream_id': '201',
      'extension_key': 'gcs-gcforms-integration'
    },
    'agencies': [
      '11'
    ]
  }
])
