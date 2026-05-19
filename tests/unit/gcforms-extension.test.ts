import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import extensionDefinition from '../../extension.config'

const testDirectory = dirname(fileURLToPath(import.meta.url))

describe('GC Forms extension manifest and entity tab contract', () => {
  it('declares static RBAC routes for entity submission tabs', () => {
    const routes = extensionDefinition.serverHandlers?.map(handler => ({
      route: handler.route,
      target: handler.rbac && 'entity' in handler.rbac ? handler.rbac.entity.target : undefined,
      param: handler.rbac && 'entity' in handler.rbac ? handler.rbac.entity.param : undefined
    }))

    expect(routes).toEqual(expect.arrayContaining([
      { route: '/agreements/[agreementId]/submissions', target: 'agreement', param: 'agreementId' },
      { route: '/proponents/[applicantRecipientId]/submissions', target: 'proponent', param: 'applicantRecipientId' },
      { route: '/claims/[claimId]/submissions', target: 'claim', param: 'claimId' },
      { route: '/monitors/[monitorId]/submissions', target: 'monitor', param: 'monitorId' }
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
    expect(helperSource).toContain('context.target === \'agreement\'')
    expect(helperSource).toContain('/agreements/${context.agreementId}/submissions')
    expect(source).not.toContain('ownerType, ownerId')
    expect(helperSource).not.toContain('/entities/')
  })
})
