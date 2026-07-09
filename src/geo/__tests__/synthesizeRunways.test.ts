import { describe, it, expect } from 'vitest'
import { synthesizeRunways } from '../synthesizeRunways'
import type { CifpRunwayInfo } from '../../types/cifp'

function info(id: string, lat: number, lon: number, lengthFt: number | null = 9000): CifpRunwayInfo {
  return { id, lat, lon, thresholdElevFt: 100, lengthFt }
}

describe('synthesizeRunways', () => {
  it('pairs opposing thresholds (RW16C + RW34C) into one runway with headings/length from coords', () => {
    const runways = synthesizeRunways({
      RW16C: info('RW16C', 47.0, -122.0),
      RW34C: info('RW34C', 47.02, -122.0),
    })

    expect(runways).toHaveLength(1)
    const rw = runways[0]
    expect(rw.id).toBe('16C/34C')
    expect(rw.lengthFt).toBe(9000)
    expect(rw.lowEnd.id).toBe('16C')
    expect(rw.highEnd.id).toBe('34C')
    // 34C threshold is due north of 16C threshold -> bearing ~0/360, reciprocal ~180.
    expect(rw.lowEnd.heading).toBeCloseTo(0, 0)
    expect(rw.highEnd.heading).toBeCloseTo(180, 0)
    expect(rw.lowEnd.lat).toBe(47.0)
    expect(rw.highEnd.lat).toBe(47.02)
  })

  it('skips a single-ended runway with no reciprocal threshold in the data', () => {
    const runways = synthesizeRunways({
      RW09: info('RW09', 47.0, -122.0),
    })
    expect(runways).toEqual([])
  })

  it('skips idents that do not parse as a valid runway number', () => {
    const runways = synthesizeRunways({
      RWXX: info('RWXX', 47.0, -122.0),
    })
    expect(runways).toEqual([])
  })

  it('pairs multiple independent runways from one airport', () => {
    const runways = synthesizeRunways({
      RW07L: info('RW07L', 47.0, -122.0),
      RW25R: info('RW25R', 47.0, -121.9),
      RW07R: info('RW07R', 47.01, -122.0),
      RW25L: info('RW25L', 47.01, -121.9),
    })
    expect(runways).toHaveLength(2)
    expect(runways.map((r) => r.id).sort()).toEqual(['07L/25R', '07R/25L'])
  })

  it('falls back to the reciprocal end length when the low end has no length', () => {
    const runways = synthesizeRunways({
      RW16C: info('RW16C', 47.0, -122.0, null),
      RW34C: info('RW34C', 47.02, -122.0, 7000),
    })
    expect(runways[0].lengthFt).toBe(7000)
  })

  it('defaults length to 0 when neither threshold carries a length', () => {
    const runways = synthesizeRunways({
      RW16C: info('RW16C', 47.0, -122.0, null),
      RW34C: info('RW34C', 47.02, -122.0, null),
    })
    expect(runways[0].lengthFt).toBe(0)
  })

  it('returns an empty array for no runway info', () => {
    expect(synthesizeRunways({})).toEqual([])
  })
})
