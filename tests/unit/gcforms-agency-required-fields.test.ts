import { translateGcsExtensionMessage, type GcsExtensionMessages } from '@gcs-ssc/extensions'
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('@gcs-ssc/extensions/ui', () => {
  const field = defineComponent({ setup: (_, { slots }) => () => h('label', slots.default?.()) })
  const input = defineComponent({ setup: () => () => h('input') })
  const button = defineComponent({
    props: ['label'], emits: ['click'],
    setup: (props, { emit }) => () => h('button', { onClick: () => emit('click') }, props.label)
  })
  return {
    useExtensionI18n: (messages: GcsExtensionMessages) => ({ locale: { value: 'en' }, t: (key: string) => translateGcsExtensionMessage(messages, 'en', key) }),
    useExtensionApi: () => ({ get: async () => ({ items: [{ id: '1', name_en: 'Name', name_fr: 'Nom', keyId: 'key', userId: 'user', formId: 'form' }] }) }),
    ExtensionButton: button, ExtensionSaveButton: button, ExtensionFormField: field,
    ExtensionInput: input, ExtensionRawTextarea: input, ExtensionCheckbox: input, ExtensionStatusSelect: input
  }
})

import AgencyConfig from '../../components/AgencyGcFormsIntegrationConfig.vue'

it('requires a private key for creation while permitting edit without replacing the saved secret', async () => {
  const wrapper = mount(AgencyConfig, { props: { modelValue: {}, agencyId: '1', extension: { key: 'gcs-gcforms-integration' } as never } })
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'New credential')!.trigger('click')
  const field = (label: string) => wrapper.findAll('label').find(item => item.attributes('label') === label)!
  for (const label of ['English name', 'French name', 'Key ID', 'User ID', 'Form ID']) {
    expect(field(label).attributes('required')).toBeDefined()
  }
  expect(field('Private key').attributes('required')).toBe('true')
  expect(field('API base URL').attributes('required')).toBeUndefined()
  await wrapper.get('[aria-label="Edit"]').trigger('click')
  expect(field('Private key').attributes('required')).toBe('false')
  expect(field('Private key').attributes('description')).toBe('Leave blank to keep the saved private key.')
})
