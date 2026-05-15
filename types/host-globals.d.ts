import '@gcs-ssc/extensions/nuxt'

declare global {
  const getRouterParam: (event: unknown, name: string) => string | undefined
  const useRuntimeConfig: () => {
    extensionSecretsEncryptionKey?: string
  }
}

export {}
