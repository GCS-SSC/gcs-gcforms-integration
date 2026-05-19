import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import extensionDefinition from '../../extension.config'

const testDirectory = dirname(fileURLToPath(import.meta.url))

describe('GC Forms extension manifest and entity tab contract', () => {
  it('does not register a source-data tab on agreements', () => {
    expect(extensionDefinition.client?.tabs.some(tab => tab.target === 'agreement')).toBe(false)
  })

  it('declares static RBAC routes for entity submission tabs', () => {
    const routes = extensionDefinition.serverHandlers?.map(handler => ({
      route: handler.route,
      subject: handler.rbac && 'subject' in handler.rbac ? handler.rbac.subject : undefined,
      action: handler.rbac && 'action' in handler.rbac ? handler.rbac.action : undefined,
      stream: handler.rbac && 'stream' in handler.rbac ? handler.rbac.stream.param : undefined,
      target: handler.rbac && 'entity' in handler.rbac ? handler.rbac.entity.target : undefined,
      param: handler.rbac && 'entity' in handler.rbac ? handler.rbac.entity.param : undefined
    }))

    expect(routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ route: '/proponents/[applicantRecipientId]/submissions', target: 'proponent', param: 'applicantRecipientId' }),
      expect.objectContaining({ route: '/claims/[claimId]/submissions', target: 'claim', param: 'claimId' }),
      expect.objectContaining({ route: '/monitors/[monitorId]/submissions', target: 'monitor', param: 'monitorId' }),
      expect.objectContaining({
        route: '/streams/[streamId]/claim-template',
        subject: 'transfer_payment',
        action: 'read',
        stream: 'streamId'
      })
    ]))
    expect(routes?.some(route => route.route.startsWith('/entities/'))).toBe(false)
  })

  it('uses the host entity tab context props', async () => {
    const source = await readFile(
      resolve(testDirectory, '../../components/GcFormsEntitySourceTab.vue'),
      'utf8'
    )
    const helperSource = await readFile(
      resolve(testDirectory, '../../components/gcforms-entity-source-tab.ts'),
      'utf8'
    )

    expect(source).toContain('context: ExtensionEntityTabContext')
    expect(helperSource).not.toContain('context.target === \'agreement\'')
    expect(helperSource).not.toContain('/agreements/${context.agreementId}/submissions')
    expect(source).not.toContain('ownerType, ownerId')
    expect(helperSource).not.toContain('/entities/')
  })

  it('adds a Claims tab action for downloading the generated claim template', async () => {
    const source = await readFile(
      resolve(testDirectory, '../../components/StreamGcFormsIntegrationConfig.vue'),
      'utf8'
    )

    expect(source).toContain('downloadClaimForm: \'Download claim form\'')
    expect(source).toContain('downloadClaimForm: \'Telecharger le formulaire de reclamation\'')
    expect(source).toContain('getJson(`/streams/${streamId}/claim-template`)')
    expect(source).toContain('gcs-claim-form-stream-${streamId}.json')
  })
})
