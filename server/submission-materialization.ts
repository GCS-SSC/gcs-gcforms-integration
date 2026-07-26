import {
  previewGcFormsMapping,
  type GcsGcFormsFieldMapping,
  type GcsGcFormsMappingIssue
} from '../shared/gcforms.ts'
import { getUnsupportedGcFormsMaterializationIssues } from './materialize-claims.ts'

/** Preflights unsupported destinations before value preview can obscure the stable materialization issue. */
export const prepareGcFormsSubmissionMaterialization = (
  answers: Record<string, unknown>,
  mappings: GcsGcFormsFieldMapping[]
): {
  values: ReturnType<typeof previewGcFormsMapping>['values']
  previewIssues: GcsGcFormsMappingIssue[]
  materializationIssues: GcsGcFormsMappingIssue[]
} => {
  const materializationIssues = getUnsupportedGcFormsMaterializationIssues(mappings)
  if (materializationIssues.length > 0) {
    return {
      values: [],
      previewIssues: [],
      materializationIssues
    }
  }

  const preview = previewGcFormsMapping(answers, mappings)
  return {
    values: preview.values,
    previewIssues: preview.issues,
    materializationIssues: []
  }
}
