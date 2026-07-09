import { describe, it, expect } from 'vitest'
import {
  isUsCoord,
  distNm,
  validateIndexRow,
  validateRunway,
  validateShard,
  crossCheckCoord,
} from '../validate'
import type { AirportIndexRow } from '../airportIndex'
import type { AirportShard } from '../validate'
import type { Runway } from '../../../src/types/airport'

function goodRow(overrides: Partial<AirportIndexRow> = {}): AirportIndexRow {
  return {
    key: 'KSEA',
    icao: 'KSEA',
    name: 'Sea-Tac',
    city: 'Seattle',
    state: 'WA',
    lat: 47.4489,
    lon: -122.3094,
    elev: 433,
    s: 3,
    t: 2,
    a: 5,
    ...overrides,
  }
}

function goodRunway(overrides: Partial<Runway> = {}): Runway {
  return {
    id: '16C/34C',
    lengthFt: 11901,
    widthFt: 150,
    surfaceCode: 'CON',
    lowEnd: { id: '16C', heading: 164, lat: 47.46, lon: -122.31, displacedThresholdFt: 0 },
    highEnd: { id: '34C', heading: 344, lat: 47.42, lon: -122.3, displacedThresholdFt: 0 },
    ...overrides,
  }
}

function goodShard(overrides: Partial<AirportShard> = {}): AirportShard {
  return {
    key: 'KSEA',
    icao: 'KSEA',
    name: 'Sea-Tac',
    city: 'Seattle',
    state: 'WA',
    lat: 47.4489,
    lon: -122.3094,
    elev: 433,
    runways: [goodRunway()],
    ...overrides,
  }
}

describe('isUsCoord', () => {
  it('accepts CONUS, Alaska, Hawaii, and territory coordinates', () => {
    expect(isUsCoord(47.4489, -122.3094)).toBe(true) // KSEA
    expect(isUsCoord(61.2, -149.9)).toBe(true) // Anchorage
    expect(isUsCoord(21.3, -157.9)).toBe(true) // Honolulu
    expect(isUsCoord(18.4, -66.0)).toBe(true) // San Juan, PR
  })

  it('rejects coordinates outside any US/territory box', () => {
    expect(isUsCoord(51.47, -0.45)).toBe(false) // London
    expect(isUsCoord(0, 0)).toBe(false)
  })

  it('rejects non-finite input', () => {
    expect(isUsCoord(NaN, -122)).toBe(false)
    expect(isUsCoord(47, Infinity)).toBe(false)
  })
})

describe('distNm', () => {
  it('returns ~0 for identical points', () => {
    expect(distNm(47.4489, -122.3094, 47.4489, -122.3094)).toBeCloseTo(0, 5)
  })

  it('computes a plausible great-circle distance (KSEA to KPDX ~ 112nm)', () => {
    const d = distNm(47.4489, -122.3094, 45.5898, -122.5951)
    expect(d).toBeGreaterThan(100)
    expect(d).toBeLessThan(125)
  })
})

describe('validateIndexRow', () => {
  it('passes a well-formed row', () => {
    expect(validateIndexRow(goodRow())).toEqual([])
  })

  it('flags an empty key', () => {
    expect(validateIndexRow(goodRow({ key: '' }))).toContain('key: empty')
  })

  it('flags a non-4-letter icao', () => {
    expect(validateIndexRow(goodRow({ icao: 'A09' }))).toEqual(
      expect.arrayContaining([expect.stringContaining('icao: not 4-letter')]),
    )
  })

  it('flags out-of-range lat', () => {
    expect(validateIndexRow(goodRow({ lat: 95 }))).toEqual(
      expect.arrayContaining([expect.stringContaining('lat: out of range')]),
    )
  })

  it('flags out-of-range lon', () => {
    expect(validateIndexRow(goodRow({ lon: 200 }))).toEqual(
      expect.arrayContaining([expect.stringContaining('lon: out of range')]),
    )
  })

  it('flags a coordinate outside US/territory bounds', () => {
    expect(validateIndexRow(goodRow({ lat: 51.47, lon: -0.45 }))).toEqual(
      expect.arrayContaining([expect.stringContaining('coord: outside US/territory bounds')]),
    )
  })

  it('flags a NaN elevation', () => {
    expect(validateIndexRow(goodRow({ elev: NaN }))).toEqual(
      expect.arrayContaining([expect.stringContaining('elev: not finite')]),
    )
  })

  it('flags a negative s/t/a count', () => {
    expect(validateIndexRow(goodRow({ s: -1 }))).toEqual(
      expect.arrayContaining([expect.stringContaining('s: not a non-negative integer')]),
    )
  })

  it('flags a non-integer s/t/a count', () => {
    expect(validateIndexRow(goodRow({ t: 1.5 }))).toEqual(
      expect.arrayContaining([expect.stringContaining('t: not a non-negative integer')]),
    )
  })

  it('flags a<=0 (rows must be approach-bearing)', () => {
    expect(validateIndexRow(goodRow({ a: 0 }))).toContain('a: must be > 0 (rows are approach-bearing only)')
  })

  it('accumulates multiple issues for a badly-formed row', () => {
    const issues = validateIndexRow(goodRow({ key: '', lat: 999, a: -1 }))
    expect(issues.length).toBeGreaterThanOrEqual(3)
  })
})

describe('validateRunway', () => {
  it('passes a well-formed runway', () => {
    expect(validateRunway(goodRunway())).toEqual([])
  })

  it('flags an empty id', () => {
    expect(validateRunway(goodRunway({ id: '' }))).toEqual(
      expect.arrayContaining([expect.stringContaining('runway.id: empty')]),
    )
  })

  it('flags a non-positive length', () => {
    expect(validateRunway(goodRunway({ lengthFt: 0 }))).toEqual(
      expect.arrayContaining([expect.stringContaining('runway.lengthFt: not > 0')]),
    )
  })

  it('flags an out-of-range heading', () => {
    const rw = goodRunway({ lowEnd: { ...goodRunway().lowEnd, heading: 400 } })
    expect(validateRunway(rw)).toEqual(
      expect.arrayContaining([expect.stringContaining('runway.lowEnd.heading: out of 0..360')]),
    )
  })

  it('flags a NaN coordinate on an end', () => {
    const rw = goodRunway({ highEnd: { ...goodRunway().highEnd, lat: NaN } })
    expect(validateRunway(rw)).toEqual(
      expect.arrayContaining([expect.stringContaining('runway.highEnd: NaN coord')]),
    )
  })

  it('flags a missing end', () => {
    const rw = { ...goodRunway(), lowEnd: undefined as unknown as Runway['lowEnd'] }
    expect(validateRunway(rw)).toEqual(
      expect.arrayContaining([expect.stringContaining('runway.lowEnd: missing')]),
    )
  })

  it('prefixes issues with the provided context', () => {
    expect(validateRunway(goodRunway({ id: '' }), '[2]')).toEqual(
      expect.arrayContaining([expect.stringContaining('[2] runway.id: empty')]),
    )
  })
})

describe('validateShard', () => {
  it('passes a well-formed shard', () => {
    expect(validateShard(goodShard())).toEqual([])
  })

  it('flags a bad top-level coord', () => {
    expect(validateShard(goodShard({ lat: 999 }))).toEqual(
      expect.arrayContaining([expect.stringContaining('lat: out of range')]),
    )
  })

  it('flags runways not being an array', () => {
    const shard = { ...goodShard(), runways: null as unknown as Runway[] }
    expect(validateShard(shard)).toContain('runways: not an array')
  })

  it('propagates a bad nested runway with its index in context', () => {
    const shard = goodShard({ runways: [goodRunway(), goodRunway({ id: '' })] })
    const issues = validateShard(shard)
    expect(issues).toEqual(expect.arrayContaining([expect.stringContaining('[1] runway.id: empty')]))
  })
})

describe('crossCheckCoord', () => {
  it('passes when index and shard positions match closely', () => {
    const row = { key: 'KSEA', lat: 47.4489, lon: -122.3094 }
    const shard = { key: 'KSEA', lat: 47.449, lon: -122.3095 }
    expect(crossCheckCoord(row, shard)).toEqual([])
  })

  it('flags a key mismatch', () => {
    const row = { key: 'KSEA', lat: 47.4489, lon: -122.3094 }
    const shard = { key: 'KPDX', lat: 47.4489, lon: -122.3094 }
    expect(crossCheckCoord(row, shard)).toEqual(
      expect.arrayContaining([expect.stringContaining('key mismatch: index KSEA vs shard KPDX')]),
    )
  })

  it('flags coordinate drift beyond maxNm', () => {
    const row = { key: 'KSEA', lat: 47.4489, lon: -122.3094 }
    const shard = { key: 'KSEA', lat: 45.5898, lon: -122.5951 } // ~129nm away (KPDX)
    expect(crossCheckCoord(row, shard, 10)).toEqual(
      expect.arrayContaining([expect.stringContaining('coord drift:')]),
    )
  })

  it('respects a custom maxNm tolerance', () => {
    const row = { key: 'KSEA', lat: 47.4489, lon: -122.3094 }
    const shard = { key: 'KSEA', lat: 47.46, lon: -122.31 } // well under 1nm
    expect(crossCheckCoord(row, shard, 0.001)).toEqual(
      expect.arrayContaining([expect.stringContaining('coord drift:')]),
    )
  })
})
