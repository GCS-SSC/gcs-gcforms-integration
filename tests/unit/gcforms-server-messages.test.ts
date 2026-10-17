import { describe, expect, it } from 'vitest'
import { gcFormsServerMessages, gcFormsUserMessage } from '../../i18n/server'

describe('GC Forms server-owned messages', () => {
  it('renders every bilingual transport message from the extension catalog', () => {
    for (const key of Object.keys(gcFormsServerMessages.en)) {
      const message = gcFormsUserMessage(key as keyof typeof gcFormsServerMessages.en, {
        fields: 'claim.total', question: 'question-1'
      })
      expect(message.en.length).toBeGreaterThan(0)
      expect(message.fr.length).toBeGreaterThan(0)
      expect(message.en).not.toMatch(/\{(?:fields|question)\}/)
      expect(message.fr).not.toMatch(/\{(?:fields|question)\}/)
    }
  })

  it('preserves literal diagnostic parameters in both transport languages', () => {
    const question = '$& {question} @ |'
    expect(gcFormsUserMessage('missing_question', { question })).toEqual({
      en: `Missing required GC Forms question: ${question}.`,
      fr: `Question Formulaires GC requise manquante : ${question}.`
    })
  })
})
