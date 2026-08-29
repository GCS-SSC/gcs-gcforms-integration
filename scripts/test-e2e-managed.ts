import { realpath, stat } from 'node:fs/promises'
import { spawn as spawnChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { delimiter, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createManagedE2eDataPaths,
  prepareManagedProductionServer,
  waitForManagedServerReady,
  type ManagedE2eDataPaths
} from '../../../scripts/test-e2e'
import {
  NUXT_ARTIFACT_LOCK_ENV,
  runWithNuxtArtifactLock
} from '../../../scripts/nuxt-artifact-lock'

type ManagedChild = {
  readonly exitCode: number | null
  readonly exited: Promise<number>
  readonly signalCode: NodeJS.Signals | null
  kill: (signal?: NodeJS.Signals) => boolean
}
type SpawnManagedChild = (
  command: string[],
  options: { cwd: string, env: NodeJS.ProcessEnv, stdio: ['inherit', 'inherit', 'inherit'] }
) => ManagedChild

export type ManagedGcFormsE2eDependencies = {
  allocatePort: () => Promise<number>
  createDataPaths: () => Promise<ManagedE2eDataPaths>
  prepareHost: (environment: NodeJS.ProcessEnv) => Promise<void>
  spawn: SpawnManagedChild
  waitForHost: (url: string, server: ManagedChild) => Promise<void>
}

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const extensionRoot = fileURLToPath(new URL('../', import.meta.url))
const acceptedSpecs = [
  'tests/e2e/gcforms-entity-source-tab.spec.ts',
  'tests/e2e/stream-mapping-grouping.spec.ts'
] as const
const defaultSpec: typeof acceptedSpecs[number] = 'tests/e2e/stream-mapping-grouping.spec.ts'

const allocatePort = async (): Promise<number> => await new Promise((resolvePort, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      reject(new Error('Could not allocate a disposable GC Forms E2E port.'))
      return
    }
    server.close(error => error ? reject(error) : resolvePort(address.port))
  })
})

const spawnManagedChild: SpawnManagedChild = (command, options) => {
  const child = spawnChildProcess(command[0]!, command.slice(1), options)
  const exited = new Promise<number>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolveExit(code ?? 1))
  })
  return {
    get exitCode() { return child.exitCode },
    exited,
    get signalCode() { return child.signalCode },
    kill: signal => child.kill(signal)
  }
}

const runRootCommand = async (command: string[], environment: NodeJS.ProcessEnv): Promise<number> => {
  const executableCommand = command[0] === 'bun'
    ? [process.execPath, ...command.slice(1)]
    : command
  const child = spawnManagedChild(executableCommand, {
    cwd: repositoryRoot,
    env: environment,
    stdio: ['inherit', 'inherit', 'inherit']
  })
  return await child.exited
}

const defaultDependencies = (): ManagedGcFormsE2eDependencies => ({
  allocatePort,
  createDataPaths: async () => await createManagedE2eDataPaths({}),
  prepareHost: async environment => {
    await prepareManagedProductionServer(
      'production',
      'development',
      command => runRootCommand(command, environment)
    )
  },
  spawn: spawnManagedChild,
  waitForHost: async (url, server) => {
    await waitForManagedServerReady(`${url}/api/health`, 60_000, server)
  }
})

const validateSpecs = async (rawArguments: string[]): Promise<string[]> => {
  const argumentsWithoutSeparator = rawArguments.filter(argument => argument !== '--')
  if (argumentsWithoutSeparator.length > 1) {
    throw new Error('GC Forms managed E2E accepts no arguments or exactly one owned spec.')
  }
  const selectedSpecs = argumentsWithoutSeparator.length === 0
    ? [defaultSpec]
    : argumentsWithoutSeparator
  if (selectedSpecs.some(argument => !acceptedSpecs.includes(argument as typeof acceptedSpecs[number]))) {
    throw new Error(`GC Forms managed E2E accepts only owned specs: ${acceptedSpecs.join(', ')}`)
  }
  const canonicalExtensionRoot = await realpath(extensionRoot)
  for (const selectedSpec of selectedSpecs) {
    const specPath = resolve(extensionRoot, selectedSpec)
    const canonicalSpecPath = await realpath(specPath)
    if (!canonicalSpecPath.startsWith(`${canonicalExtensionRoot}/`) || !(await stat(canonicalSpecPath)).isFile()) {
      throw new Error(`GC Forms E2E spec is not a canonical extension-owned file: ${selectedSpec}`)
    }
  }
  return selectedSpecs
}

export const runManagedGcFormsE2e = async (
  rawArguments: string[],
  inheritedEnvironment: NodeJS.ProcessEnv = process.env,
  dependencies: ManagedGcFormsE2eDependencies = defaultDependencies()
): Promise<void> => {
  const selectedSpecs = await validateSpecs(rawArguments)
  const dataPaths = await dependencies.createDataPaths()
  let server: ManagedChild | undefined
  let playwright: ManagedChild | undefined
  let cleanedUp = false
  const cleanup = async (): Promise<void> => {
    if (cleanedUp) return
    cleanedUp = true
    playwright?.kill()
    server?.kill()
    await Promise.allSettled([
      playwright?.exited,
      server?.exited,
      dataPaths.cleanup()
    ].filter((value): value is Promise<number> | Promise<void> => value !== undefined))
  }
  const exitForSignal = (code: number): void => { void cleanup().finally(() => process.exit(code)) }
  const handleSigint = (): void => exitForSignal(130)
  const handleSigterm = (): void => exitForSignal(143)

  try {
    const port = await dependencies.allocatePort()
    const baseUrl = `http://127.0.0.1:${port}`
    const executableDirectory = dirname(process.execPath)
    const inheritedPath = inheritedEnvironment.PATH
    const environment: NodeJS.ProcessEnv = {
      ...inheritedEnvironment,
      BETTER_AUTH_DISABLE_LOGGER: 'true',
      BETTER_AUTH_SECRET: 'abcdefghijklmnopqrstuvwxyz123456',
      BETTER_AUTH_TRUSTED_ORIGINS: baseUrl,
      BETTER_AUTH_URL: baseUrl,
      ENVIRONMENT_TYPE: 'development',
      GCS_E2E_EXTENSION_WORKSPACE: 'gcs-gcforms-integration',
      GCS_E2E_SERVER_MODE: 'production',
      GCS_E2E_SUITE: 'extension-gcforms',
      GCS_LOCAL_FILE_STORAGE_DIR: dataPaths.localFileStorageDir,
      NUXT_DISABLE_SOURCEMAPS: 'true',
      PATH: inheritedPath ? `${executableDirectory}${delimiter}${inheritedPath}` : executableDirectory,
      PGLITE_DATA_DIR: dataPaths.pgliteDataDir,
      PLAYWRIGHT_BASE_URL: baseUrl,
      PLAYWRIGHT_WORKERS: '1'
    }
    delete environment.DATABASE_URL
    delete environment.E2E_POSTGRES_TEST_URL
    delete environment.NUXT_DATABASE_URL
    delete environment.PGOPTIONS

    await dependencies.prepareHost(environment)
    server = dependencies.spawn(['node', '.output/server/index.mjs'], {
      cwd: repositoryRoot,
      env: { ...environment, PORT: String(port) },
      stdio: ['inherit', 'inherit', 'inherit']
    })
    process.once('SIGINT', handleSigint)
    process.once('SIGTERM', handleSigterm)
    await dependencies.waitForHost(baseUrl, server)
    playwright = dependencies.spawn([
      process.execPath, 'x', 'playwright', 'test', '--config', 'playwright.config.ts', ...selectedSpecs
    ], {
      cwd: extensionRoot,
      env: environment,
      stdio: ['inherit', 'inherit', 'inherit']
    })
    const outcome = await Promise.race([
      playwright.exited.then(exitCode => ({ exitCode, owner: 'playwright' as const })),
      server.exited.then(exitCode => ({ exitCode, owner: 'server' as const }))
    ])
    if (outcome.owner === 'server') {
      throw new Error(`Managed GC Forms host exited during Playwright with code ${outcome.exitCode}.`)
    }
    if (outcome.exitCode !== 0) throw new Error(`GC Forms Playwright exited with code ${outcome.exitCode}.`)
  } finally {
    process.off('SIGINT', handleSigint)
    process.off('SIGTERM', handleSigterm)
    await cleanup()
  }
}

const main = async (): Promise<void> => {
  if (process.env[NUXT_ARTIFACT_LOCK_ENV] !== '1') {
    process.exitCode = await runWithNuxtArtifactLock(
      [process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      process.env,
      repositoryRoot
    )
    return
  }
  await runManagedGcFormsE2e(process.argv.slice(2))
}

if (import.meta.main) await main()
