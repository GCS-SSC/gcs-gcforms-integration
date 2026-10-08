import { describe, expect, it } from 'vitest'
import { translateGcsExtensionMessage } from '@gcs-ssc/extensions'
import { StreamGcFormsIntegrationConfigMessages } from '../../i18n/StreamGcFormsIntegrationConfig'

describe('GC Forms Data Collection entity labels', () => {
  it.each([['en', 'Data Collections'], ['fr', 'Collectes de données']] as const)(
    'resolves the %s label from the extension-owned catalog', (locale, expected) => {
      expect(translateGcsExtensionMessage(StreamGcFormsIntegrationConfigMessages, locale, 'commondatacollection')).toBe(expected)
    }
  )
})
