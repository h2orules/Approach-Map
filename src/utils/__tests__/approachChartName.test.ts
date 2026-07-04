import { describe, it, expect } from 'vitest'
import { matchChartName } from '../approachChartName'

// Representative d-TPP chart_name table, structured like a real KSEA extract:
// composite ILS/LOC charts, an SA CAT I ILS variant, RNAV Y/Z variants, and a
// circling-only NDB chart.
const KSEA_CHARTS = [
  'ILS OR LOC RWY 16C',
  'ILS RWY 16C (SA CAT I)',
  'RNAV (GPS) Y RWY 16C',
  'RNAV (GPS) Z RWY 16C',
  'RNAV (RNP) Z RWY 16C',
  'VOR/DME-A',
  'NDB-C',
]

describe('matchChartName', () => {
  it('I16C picks the plain composite ILS OR LOC chart, not the SA CAT variant', () => {
    expect(matchChartName({ name: 'I16C', runways: ['16C'] }, KSEA_CHARTS)).toBe(
      'ILS OR LOC RWY 16C',
    )
  })

  it('R16CY picks RNAV (GPS) Y RWY 16C, not the Z variant', () => {
    expect(matchChartName({ name: 'R16CY', runways: ['16C'] }, KSEA_CHARTS)).toBe(
      'RNAV (GPS) Y RWY 16C',
    )
  })

  it('H16CZ picks RNAV (RNP) Z RWY 16C, not the RNAV (GPS) Z chart', () => {
    expect(matchChartName({ name: 'H16CZ', runways: ['16C'] }, KSEA_CHARTS)).toBe(
      'RNAV (RNP) Z RWY 16C',
    )
  })

  it('VDM-A (circling) picks VOR/DME-A', () => {
    expect(matchChartName({ name: 'VDM-A', runways: [] }, KSEA_CHARTS)).toBe('VOR/DME-A')
  })

  it('NDB-C (circling) picks NDB-C', () => {
    expect(matchChartName({ name: 'NDB-C', runways: [] }, KSEA_CHARTS)).toBe('NDB-C')
  })

  it('returns null when no chart matches the runway', () => {
    expect(matchChartName({ name: 'I34L', runways: ['34L'] }, KSEA_CHARTS)).toBeNull()
  })

  it('returns null for an unparseable ident', () => {
    expect(matchChartName({ name: '???', runways: [] }, KSEA_CHARTS)).toBeNull()
  })
})
