import { describe, it, expect } from 'vitest'
import { approachRunwayKey, approachPriority } from '../approachPriority'
import type { Procedure } from '../../types/procedure'
import type { AtisInfo } from '../../api/datis'

function proc(name: string, runways: string[] = []): Procedure {
  return {
    id: name,
    icao: 'KSEA',
    name,
    type: 'APPROACH',
    runways,
    waypoints: [],
    symbols: [],
    geojson: { type: 'FeatureCollection', features: [] },
    hasGeometry: true,
    color: '#34d399',
  }
}

function atis(runwayPrefs: Record<string, string[]>): AtisInfo {
  return { code: 'A', runwayPrefs, depRunways: [], visualRunways: [], raw: '' }
}

describe('approachRunwayKey', () => {
  it('extracts the runway from a CIFP approach name', () => {
    expect(approachRunwayKey(proc('I16C'))).toBe('16C')
    expect(approachRunwayKey(proc('R34C'))).toBe('34C')
    expect(approachRunwayKey(proc('L28'))).toBe('28')
  })

  it('falls back to sorted runways for non-runway-specific approaches', () => {
    expect(approachRunwayKey(proc('VDME-A', ['16R', '16L']))).toBe('16L,16R')
  })
})

describe('approachPriority', () => {
  it('lets ATIS order beat the static I>R>H>L order', () => {
    const info = atis({ '16C': ['R', 'I'] })
    expect(approachPriority(proc('R16C'), info)).toBeGreaterThan(approachPriority(proc('I16C'), info))
  })

  it('preserves ATIS text order within a runway', () => {
    const info = atis({ '34C': ['I', 'L'] })
    expect(approachPriority(proc('I34C'), info)).toBe(100)
    expect(approachPriority(proc('L34C'), info)).toBe(99)
  })

  it('falls back to static I>R>H>L when ATIS is absent or silent', () => {
    expect(approachPriority(proc('I16C'), null)).toBeGreaterThan(approachPriority(proc('R16C'), null))
    expect(approachPriority(proc('R16C'), null)).toBeGreaterThan(approachPriority(proc('H16C'), null))
    expect(approachPriority(proc('H16C'), null)).toBeGreaterThan(approachPriority(proc('L16C'), null))
    // A type not listed in ATIS still uses the static order.
    expect(approachPriority(proc('I16C'), atis({ '16C': ['R'] }))).toBeLessThan(
      approachPriority(proc('R16C'), atis({ '16C': ['R'] })),
    )
  })
})
