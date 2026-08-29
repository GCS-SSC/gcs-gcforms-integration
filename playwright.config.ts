import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || ['/usr/bin/chromium', '/usr/bin/chromium-browser'].find(path => existsSync(path))
const uiActionReporterPath = process.env.GCS_UI_ACTION_REPORTER_PATH
  || fileURLToPath(new URL('../../.agents/skills/gcs-ssc/scripts/whole-review/ui-action-playwright-reporter.ts', import.meta.url))

export default defineConfig({
  reporter: process.env.GCS_UI_ACTION_RESULT_PATH
    ? [['list'], [uiActionReporterPath]]
    : 'list',
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    browserName: 'chromium',
    executablePath: chromiumExecutablePath,
    channel: chromiumExecutablePath ? undefined : process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    headless: true,
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure'
  }
})
