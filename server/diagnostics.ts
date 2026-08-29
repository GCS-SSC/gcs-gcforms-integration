import type { GcsExtensionRouteContext } from '@gcs-ssc/extensions/server'
import {
  GcsGcFormsDiagnosticParamsSchema,
  parseGcFormsStoredMappingIssues,
  renderGcFormsDiagnostic,
  renderGcFormsMappingIssue,
  resolveGcFormsDiagnosticLocale,
  sanitizeGcFormsDiagnostic,
  type GcsGcFormsDiagnosticLocale,
  type GcsGcFormsDiagnosticParams,
  type GcsGcFormsRenderedMappingIssue,
  type GcsGcFormsStoredDiagnostic
} from '../shared/gcforms.ts'

const cookieLocale = (cookieHeader: string | undefined): GcsGcFormsDiagnosticLocale | null => {
  const locale = cookieHeader
    ?.split(';')
    .map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith('i18n_redirected='))
    ?.slice('i18n_redirected='.length)
  return locale?.startsWith('fr')
    ? 'fr'
    : locale?.startsWith('en') ? 'en' : null
}

const acceptedLocale = (acceptedLanguage: string | undefined): GcsGcFormsDiagnosticLocale | null =>
  acceptedLanguage
    ?.split(',')
    .map((entry, index) => {
      const [range = '', ...parameters] = entry.trim().toLowerCase().split(';')
      const qualityValue = parameters.find(parameter => parameter.trim().startsWith('q='))?.trim().slice(2)
      const parsedQuality = qualityValue === undefined ? 1 : Number(qualityValue)
      const quality = Number.isFinite(parsedQuality) && parsedQuality >= 0 && parsedQuality <= 1
        ? parsedQuality
        : 0
      const locale = range === 'fr' || range.startsWith('fr-')
        ? 'fr' as const
        : range === 'en' || range.startsWith('en-') ? 'en' as const : null
      return { index, locale, quality }
    })
    .filter(candidate => candidate.locale !== null && candidate.quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index)[0]?.locale ?? null

/** Resolves the active request locale using the host's cookie-first and weighted-header order. */
export const getGcFormsDiagnosticLocale = (
  context: GcsExtensionRouteContext
): GcsGcFormsDiagnosticLocale => {
  const header = (name: string): string | undefined => {
    try {
      return context.getHeader?.(name)
    } catch {
      // Direct unit/tooling invocation has no host H3 event; production requests always do.
      return undefined
    }
  }

  return cookieLocale(header('cookie'))
    ?? acceptedLocale(header('accept-language'))
    ?? resolveGcFormsDiagnosticLocale(undefined)
}

/** Parses message-free structured params from a database JSON value. */
export const parseGcFormsDiagnosticParams = (
  value: unknown
): GcsGcFormsDiagnosticParams => {
  const parsed = GcsGcFormsDiagnosticParamsSchema.safeParse(value)
  return parsed.success ? parsed.data : {}
}

/** Renders one stored submission diagnostic for an API response. */
export const renderStoredGcFormsDiagnostic = (
  code: string | null,
  params: unknown,
  locale: GcsGcFormsDiagnosticLocale
): (GcsGcFormsStoredDiagnostic & { message: string }) | null => {
  if (!code) {
    return null
  }

  const diagnostic = sanitizeGcFormsDiagnostic({
    code,
    params: parseGcFormsDiagnosticParams(params)
  })
  return {
    ...diagnostic,
    message: renderGcFormsDiagnostic(diagnostic, locale)
  }
}

/** Renders every valid persisted mapping issue for an API response. */
export const renderStoredGcFormsMappingIssues = (
  value: unknown,
  locale: GcsGcFormsDiagnosticLocale
): GcsGcFormsRenderedMappingIssue[] => parseGcFormsStoredMappingIssues(value)
  .map(issue => renderGcFormsMappingIssue(issue, locale))
