import { describe, expect, it, vi } from 'vitest'
import { delimiter, dirname } from 'node:path'
import {
  runManagedGcFormsE2e,
  type ManagedGcFormsE2eDependencies
} from '../../scripts/test-e2e-managed'

const ownedSpec = 'tests/e2e/stream-mapping-grouping.spec.ts'
const entitySourceSpec = 'tests/e2e/gcforms-entity-source-tab.spec.ts'

const controlledChild = (exitCode?: number) => {
  let finish: ((code: number) => void) | undefined
  const exited = exitCode === undefined
    ? new Promise<number>(resolve => { finish = resolve })
    : Promise.resolve(exitCode)
  return {
    child: {
      exited,
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => {
        finish?.(143)
        return true
      })
    },
    finish
  }
}

const fixture = (playwrightExitCode: number | null = 0, serverExitCode: number | null = null) => {
  const server = controlledChild(serverExitCode ?? undefined)
  const playwright = controlledChild(playwrightExitCode ?? undefined)
  const cleanup = vi.fn(async () => {})
  const spawn = vi.fn((command: string[]) => command[0] === 'node' ? server.child : playwright.child)
  const dependencies: ManagedGcFormsE2eDependencies = {
    allocatePort: vi.fn(async () => 43123),
    createDataPaths: vi.fn(async () => ({
      cleanup,
      localFileStorageDir: '/tmp/gcforms-files-owned',
      ownsLocalFileStorageDir: true,
      ownsPgliteDataDir: true,
      pgliteDataDir: '/tmp/gcforms-pglite-owned'
    })),
    prepareHost: vi.fn(async () => {}),
    spawn,
    waitForHost: vi.fn(async () => {})
  }
  return { cleanup, dependencies, playwright, server, spawn }
}

describe('GC Forms managed E2E runner', () => {
  it('runs the extension-owned spec against an owned disposable production host', async () => {
    const state = fixture()
    await runManagedGcFormsE2e([ownedSpec], {
      DATABASE_URL: 'postgres://must-not-leak',
      GCS_UI_ACTION_RUN_ID: 'RUN-extension-observation'
    }, state.dependencies)

    expect(state.dependencies.prepareHost).toHaveBeenCalledOnce()
    const preparedEnvironment = vi.mocked(state.dependencies.prepareHost).mock.calls[0]![0]
    expect(preparedEnvironment).toMatchObject({
      ENVIRONMENT_TYPE: 'demo',
      GCS_LOCAL_FILE_STORAGE_DIR: '/tmp/gcforms-files-owned',
      GCS_UI_ACTION_RUN_ID: 'RUN-extension-observation',
      PGLITE_DATA_DIR: '/tmp/gcforms-pglite-owned',
      PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:43123'
    })
    expect(preparedEnvironment.PATH?.split(delimiter)[0]).toBe(dirname(process.execPath))
    expect(preparedEnvironment.DATABASE_URL).toBeUndefined()
    expect(state.spawn.mock.calls[0]![0]).toEqual(['node', '.output/server/index.mjs'])
    expect(state.spawn.mock.calls[1]![0]).toEqual([
      process.execPath, 'x', 'playwright', 'test', '--config', 'playwright.config.ts', ownedSpec
    ])
    expect(state.server.child.kill).toHaveBeenCalledOnce()
    expect(state.playwright.child.kill).toHaveBeenCalledOnce()
    expect(state.cleanup).toHaveBeenCalledOnce()
  })

  it('runs exactly the declared default spec when no focused spec is supplied', async () => {
    const state = fixture()
    await runManagedGcFormsE2e([], {}, state.dependencies)

    expect(state.spawn.mock.calls[1]![0]).toEqual([
      process.execPath,
      'x',
      'playwright',
      'test',
      '--config',
      'playwright.config.ts',
      ownedSpec
    ])
    expect(state.cleanup).toHaveBeenCalledOnce()
  })

  it('allows exactly one other supported extension-owned spec', async () => {
    const state = fixture()
    await runManagedGcFormsE2e([entitySourceSpec], {}, state.dependencies)

    expect(state.spawn.mock.calls[1]![0]).toEqual([
      process.execPath,
      'x',
      'playwright',
      'test',
      '--config',
      'playwright.config.ts',
      entitySourceSpec
    ])
    expect(state.cleanup).toHaveBeenCalledOnce()
  })

  it('fails closed and cleans up when Playwright fails', async () => {
    const state = fixture(2)
    await expect(runManagedGcFormsE2e([ownedSpec], {}, state.dependencies))
      .rejects.toThrow('GC Forms Playwright exited with code 2')
    expect(state.server.child.kill).toHaveBeenCalledOnce()
    expect(state.cleanup).toHaveBeenCalledOnce()
  })

  it('fails closed and terminates Playwright if the managed host exits', async () => {
    const state = fixture(null, 7)
    await expect(runManagedGcFormsE2e([ownedSpec], {}, state.dependencies))
      .rejects.toThrow('Managed GC Forms host exited during Playwright with code 7')
    expect(state.playwright.child.kill).toHaveBeenCalledOnce()
    expect(state.cleanup).toHaveBeenCalledOnce()
  })

  it('rejects arbitrary or cross-workspace specs before allocating resources', async () => {
    const state = fixture()
    await expect(runManagedGcFormsE2e(['../../tests/e2e/gcforms-host-contract.spec.ts'], {}, state.dependencies))
      .rejects.toThrow(`accepts only owned specs: ${entitySourceSpec}, ${ownedSpec}`)
    expect(state.dependencies.allocatePort).not.toHaveBeenCalled()
    expect(state.dependencies.createDataPaths).not.toHaveBeenCalled()
    expect(state.spawn).not.toHaveBeenCalled()
  })

  it('rejects Playwright options before allocating resources', async () => {
    const state = fixture()
    await expect(runManagedGcFormsE2e(['--list'], {}, state.dependencies))
      .rejects.toThrow(`accepts only owned specs: ${entitySourceSpec}, ${ownedSpec}`)
    expect(state.dependencies.allocatePort).not.toHaveBeenCalled()
    expect(state.dependencies.createDataPaths).not.toHaveBeenCalled()
    expect(state.spawn).not.toHaveBeenCalled()
  })

  it('rejects multiple owned specs before allocating resources', async () => {
    const state = fixture()
    await expect(runManagedGcFormsE2e([entitySourceSpec, ownedSpec], {}, state.dependencies))
      .rejects.toThrow('accepts no arguments or exactly one owned spec')
    expect(state.dependencies.allocatePort).not.toHaveBeenCalled()
    expect(state.dependencies.createDataPaths).not.toHaveBeenCalled()
    expect(state.spawn).not.toHaveBeenCalled()
  })
})
