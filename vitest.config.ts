import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.ts']
  },
  resolve: {
    alias: [
      { find: /^@gcs-ssc\/extensions\/server$/, replacement: new URL('../../packages/gcs-ssc-extensions/src/server.ts', import.meta.url).pathname },
      { find: /^@gcs-ssc\/extensions\/nuxt$/, replacement: new URL('../../packages/gcs-ssc-extensions/src/nuxt.ts', import.meta.url).pathname },
      { find: /^@gcs-ssc\/extensions$/, replacement: new URL('../../packages/gcs-ssc-extensions/src/index.ts', import.meta.url).pathname }
    ]
  }
})
