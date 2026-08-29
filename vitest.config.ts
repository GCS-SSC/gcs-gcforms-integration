import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export const GCFORMS_COVERAGE_INCLUDE = [
  'components/**/*.{ts,vue}',
  'extension.config.ts',
  'server/api/**/*.ts',
  'server/*.ts',
  'server/plugins/**/*.ts',
  'shared/**/*.ts'
]

export const GCFORMS_COVERAGE_THRESHOLDS = {
  lines: 80,
  functions: 80,
  branches: 80,
  statements: 80
} as const

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: 'coverage/unit',
      include: GCFORMS_COVERAGE_INCLUDE,
      thresholds: GCFORMS_COVERAGE_THRESHOLDS
    }
  }
})
