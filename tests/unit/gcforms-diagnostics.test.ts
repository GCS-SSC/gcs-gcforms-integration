import { describe, expect, it } from 'vitest'
import {
  GCFORMS_DIAGNOSTIC_CODES,
  GCFORMS_DIAGNOSTIC_MESSAGES,
  parseGcFormsStoredMappingIssues,
  renderGcFormsDiagnostic,
  resolveGcFormsDiagnosticLocale,
  type GcsGcFormsDiagnosticParams
} from '../../shared/gcforms'
import {
  getGcFormsDiagnosticLocale,
  parseGcFormsDiagnosticParams,
  renderStoredGcFormsDiagnostic,
  renderStoredGcFormsMappingIssues
} from '../../server/diagnostics'

const placeholders = (template: string): string[] => [
  ...template.matchAll(/\{([^{}]+)\}/g)
].map(match => match[1] ?? '').sort()

const completeParams: GcsGcFormsDiagnosticParams = {
  destinationEntity: 'source_record',
  destinationPath: 'claim.egcs_fc_fundingagreement',
  row: 2,
  statusCode: 'GCS_GCFORMS_SUBMISSION_STATUS_INVALID'
}

describe('GC Forms persisted diagnostics', () => {
  it('keeps English and French placeholders in parity for every stable code', () => {
    for (const code of GCFORMS_DIAGNOSTIC_CODES) {
      expect(placeholders(GCFORMS_DIAGNOSTIC_MESSAGES.fr[code]))
        .toEqual(placeholders(GCFORMS_DIAGNOSTIC_MESSAGES.en[code]))
      expect(renderGcFormsDiagnostic({ code, params: completeParams }, 'en')).not.toContain('{')
      expect(renderGcFormsDiagnostic({ code, params: completeParams }, 'fr')).not.toContain('{')
    }
  })

  it('renders the same stored code and params in the active English or French locale', () => {
    const diagnostic = {
      code: 'agreement_not_found',
      params: { destinationPath: 'claim.egcs_fc_fundingagreement' }
    }

    expect(renderGcFormsDiagnostic(diagnostic, 'en'))
      .toBe('The agreement for claim.egcs_fc_fundingagreement could not be found in this transfer payment stream.')
    expect(renderGcFormsDiagnostic(diagnostic, 'fr'))
      .toBe('L’entente pour claim.egcs_fc_fundingagreement est introuvable dans ce volet de paiements de transfert.')
    expect(resolveGcFormsDiagnosticLocale('fr-CA')).toBe('fr')
    expect(resolveGcFormsDiagnosticLocale('en-CA')).toBe('en')
    expect(resolveGcFormsDiagnosticLocale(undefined)).toBe('en')
  })

  it('uses a safe localized fallback for unknown codes and missing placeholders', () => {
    const rawProviderDetail = 'SQLSTATE 23505 secret@example.test'

    expect(renderGcFormsDiagnostic({
      code: 'provider_detail_not_for_display',
      params: { rawProviderDetail }
    }, 'en')).toBe('GC Forms could not complete this mapping.')
    expect(renderGcFormsDiagnostic({
      code: 'provider_detail_not_for_display',
      params: { rawProviderDetail }
    }, 'fr')).toBe('GC Forms n’a pas pu terminer cette correspondance.')
    expect(renderGcFormsDiagnostic({
      code: 'agreement_not_found',
      params: { rawProviderDetail }
    }, 'fr')).toBe('GC Forms n’a pas pu terminer cette correspondance.')
    expect(renderGcFormsDiagnostic({
      code: 'agreement_not_found',
      params: [] as unknown as GcsGcFormsDiagnosticParams
    }, 'en')).toBe('GC Forms could not complete this mapping.')
  })

  it('accepts message-free future codes but rejects the obsolete message contract and raw extras', () => {
    expect(parseGcFormsStoredMappingIssues([{
      mappingId: 'future',
      sourceQuestionId: 'source',
      destinationPath: 'claim.future',
      code: 'future_code',
      params: { detailId: 14 }
    }])).toEqual([{
      mappingId: 'future',
      sourceQuestionId: 'source',
      destinationPath: 'claim.future',
      code: 'future_code',
      params: { detailId: 14 }
    }])
    expect(parseGcFormsStoredMappingIssues([{
      mappingId: 'legacy',
      sourceQuestionId: 'source',
      destinationPath: 'claim.legacy',
      code: 'agreement_not_found',
      message: 'raw legacy provider detail'
    }])).toEqual([])
    expect(parseGcFormsStoredMappingIssues([{
      mappingId: 'mixed',
      sourceQuestionId: 'source',
      destinationPath: 'claim.mixed',
      code: 'agreement_not_found',
      params: { destinationPath: 'claim.mixed' },
      message: 'raw detail must not cross the boundary'
    }])).toEqual([])
  })

  it('resolves cookie and weighted request locales without trusting malformed headers', () => {
    const context = (
      cookie: string | undefined,
      acceptedLanguage: string | undefined
    ) => ({
      getHeader: (name: string) => name === 'cookie' ? cookie : acceptedLanguage
    }) as any

    expect(getGcFormsDiagnosticLocale(context('theme=dark; i18n_redirected=fr-CA', 'en'))).toBe('fr')
    expect(getGcFormsDiagnosticLocale(context('i18n_redirected=en-CA', 'fr'))).toBe('en')
    expect(getGcFormsDiagnosticLocale(context(
      'i18n_redirected=es',
      'de;q=1,en-US;q=0.4,fr-CA;q=0.8'
    ))).toBe('fr')
    expect(getGcFormsDiagnosticLocale(context(undefined, 'fr;q=invalid,en'))).toBe('en')
    expect(getGcFormsDiagnosticLocale(context(undefined, 'fr;q=0,en;q=1.5,en-CA;q=0.7'))).toBe('en')
    expect(getGcFormsDiagnosticLocale(context(undefined, 'fr;q=0.8,en;q=0.8'))).toBe('fr')
    expect(getGcFormsDiagnosticLocale({
      getHeader: () => {
        throw new TypeError('No host event in tooling.')
      }
    } as any)).toBe('en')
    expect(getGcFormsDiagnosticLocale({} as any)).toBe('en')
  })

  it('normalizes stored boundary values and localizes valid persisted issues', () => {
    expect(parseGcFormsDiagnosticParams({ destinationPath: 'claim.path', row: 1 }))
      .toEqual({ destinationPath: 'claim.path', row: 1 })
    expect(parseGcFormsDiagnosticParams({ nested: { raw: 'not allowed' } })).toEqual({})
    expect(renderStoredGcFormsDiagnostic(null, {}, 'fr')).toBeNull()
    expect(renderStoredGcFormsDiagnostic('unknown_provider_code', { raw: 'hidden' }, 'fr')).toEqual({
      code: 'unknown_diagnostic',
      params: {},
      message: 'GC Forms n’a pas pu terminer cette correspondance.'
    })
    expect(renderStoredGcFormsMappingIssues('not-an-array', 'en')).toEqual([])
    expect(renderStoredGcFormsMappingIssues([{
      mappingId: 'known',
      sourceQuestionId: 'source',
      destinationPath: 'claim.path',
      code: 'missing_required_value',
      params: { destinationPath: 'claim.path', raw: 'must be removed' }
    }], 'en')).toEqual([{
      mappingId: 'known',
      sourceQuestionId: 'source',
      destinationPath: 'claim.path',
      code: 'missing_required_value',
      params: { destinationPath: 'claim.path' },
      message: 'A required GC Forms value is missing for claim.path.'
    }])
    expect(JSON.stringify(renderStoredGcFormsMappingIssues([{
      mappingId: 'unknown',
      sourceQuestionId: 'source',
      destinationPath: 'claim.path',
      code: 'SQLSTATE 23505 secret@example.test',
      params: { raw: 'private provider detail' }
    }], 'en'))).toBe(JSON.stringify([{
      mappingId: 'unknown',
      sourceQuestionId: 'source',
      destinationPath: 'claim.path',
      code: 'unknown_diagnostic',
      params: {},
      message: 'GC Forms could not complete this mapping.'
    }]))
  })
})
