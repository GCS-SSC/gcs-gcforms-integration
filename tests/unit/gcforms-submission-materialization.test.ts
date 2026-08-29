import { describe, expect, it } from 'vitest'
import { prepareGcFormsSubmissionMaterialization } from '../../server/submission-materialization'
import { shouldConfirmGcFormsSubmission } from '../../server/submission-confirmation'

describe('GC Forms submission materialization preflight', () => {
  it('preserves unsupported destination issues when the required source answer is missing', () => {
    const prepared = prepareGcFormsSubmissionMaterialization({}, [{
      id: 'unsupported-required',
      sourceQuestionId: 'missing_payload',
      destinationEntity: 'source_record',
      destinationPath: 'payload',
      transform: 'json',
      required: true,
      onMissing: 'block',
      onInvalid: 'block'
    }])

    expect(prepared).toEqual({
      values: [],
      previewIssues: [],
      materializationIssues: [{
        mappingId: 'unsupported-required',
        sourceQuestionId: 'missing_payload',
        destinationPath: 'payload',
        code: 'unsupported_destination',
        params: {
          destinationEntity: 'source_record',
          destinationPath: 'payload'
        }
      }]
    })
    expect(shouldConfirmGcFormsSubmission(true, 'failed', prepared.materializationIssues)).toBe(false)
  })
})
