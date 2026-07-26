import { describe, expect, it } from 'vitest'
import { shouldConfirmGcFormsSubmission } from '../../server/submission-confirmation'

describe('GC Forms submission confirmation', () => {
  it('confirms only newly created issue-free materializations', () => {
    expect(shouldConfirmGcFormsSubmission(true, 'created', [])).toBe(true)
    expect(shouldConfirmGcFormsSubmission(false, 'created', [])).toBe(false)
    expect(shouldConfirmGcFormsSubmission(true, 'not_applicable', [])).toBe(false)
    expect(shouldConfirmGcFormsSubmission(true, 'failed', [{
      mappingId: 'unsupported-1',
      sourceQuestionId: 'payload',
      destinationPath: 'payload',
      code: 'unsupported_destination',
      message: 'Unsupported destination.'
    }])).toBe(false)
  })
})
