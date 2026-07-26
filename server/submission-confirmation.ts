import type { GcsGcFormsMappingIssue } from '../shared/gcforms.ts'

/** Confirms only newly materialized, issue-free submissions when confirmation is enabled. */
export const shouldConfirmGcFormsSubmission = (
  confirmationEnabled: boolean,
  materializationStatus: string,
  issues: GcsGcFormsMappingIssue[]
): boolean => confirmationEnabled
  && materializationStatus === 'created'
  && issues.length === 0
