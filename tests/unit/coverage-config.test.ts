import { describe, expect, it } from 'vitest'

import config, {
  GCFORMS_COVERAGE_INCLUDE,
  GCFORMS_COVERAGE_THRESHOLDS
} from '../../vitest.config'

type CoverageConfig = {
  include?: string[]
  thresholds?: Partial<Record<keyof typeof GCFORMS_COVERAGE_THRESHOLDS, number>>
}
type CoverageProjectConfig = { test?: { coverage?: CoverageConfig } }

const assertCoverageContract = (coverage: CoverageConfig): void => {
  for (const source of GCFORMS_COVERAGE_INCLUDE) expect(coverage.include).toContain(source)
  expect(coverage.thresholds).toEqual(GCFORMS_COVERAGE_THRESHOLDS)
}

describe('GC Forms coverage configuration', () => {
  const coverage = (config as CoverageProjectConfig).test?.coverage as CoverageConfig

  it('enforces the owner source universe and all four thresholds', () => {
    assertCoverageContract(coverage)
  })

  it.each(GCFORMS_COVERAGE_INCLUDE)('fails closed when %s is removed', (source) => {
    expect(() => assertCoverageContract({
      ...coverage,
      include: coverage.include?.filter(entry => entry !== source)
    })).toThrow()
  })

  it('fails closed when any threshold is lowered', () => {
    expect(() => assertCoverageContract({
      ...coverage,
      thresholds: { ...coverage.thresholds, branches: 79 }
    })).toThrow()
  })
})
