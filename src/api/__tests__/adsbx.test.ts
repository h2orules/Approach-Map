import { describe, it, expect } from 'vitest'
import { mergeAircraftResponses } from '../adsbx'
import type { AdsbAircraft, AdsbResponse } from '../../types/aircraft'

function ac(hex: string, seen?: number, seen_pos?: number, extra: Partial<AdsbAircraft> = {}): AdsbAircraft {
  return { hex, seen, seen_pos, ...extra }
}

function resp(...aircraft: AdsbAircraft[]): AdsbResponse {
  return { ac: aircraft, total: aircraft.length, ctime: 0, ptime: 0 }
}

describe('mergeAircraftResponses', () => {
  it('dedupes a hex present in two cluster responses, keeping the fresher (smaller seen)', () => {
    const stale = ac('abc123', 8.0, 8.0, { flight: 'STALE' })
    const fresh = ac('abc123', 1.0, 1.0, { flight: 'FRESH' })
    const merged = mergeAircraftResponses([resp(stale), resp(fresh)])
    expect(merged).toHaveLength(1)
    expect(merged[0].flight).toBe('FRESH')
  })

  it('keeps the fresher copy regardless of which response it came in', () => {
    const fresh = ac('abc123', 1.0, 1.0, { flight: 'FRESH' })
    const stale = ac('abc123', 8.0, 8.0, { flight: 'STALE' })
    // Fresh first, stale second — the incumbent must not be overwritten by staler.
    const merged = mergeAircraftResponses([resp(fresh), resp(stale)])
    expect(merged).toHaveLength(1)
    expect(merged[0].flight).toBe('FRESH')
  })

  it('breaks a seen tie by the smaller seen_pos', () => {
    const a = ac('abc123', 2.0, 5.0, { flight: 'OLDPOS' })
    const b = ac('abc123', 2.0, 0.5, { flight: 'NEWPOS' })
    expect(mergeAircraftResponses([resp(a), resp(b)])[0].flight).toBe('NEWPOS')
    // Order-independent.
    expect(mergeAircraftResponses([resp(b), resp(a)])[0].flight).toBe('NEWPOS')
  })

  it('treats a missing seen as +Infinity (loses to any real value)', () => {
    const noSeen = ac('abc123', undefined, undefined, { flight: 'NOSEEN' })
    const real = ac('abc123', 5.0, 5.0, { flight: 'REAL' })
    expect(mergeAircraftResponses([resp(noSeen), resp(real)])[0].flight).toBe('REAL')
    expect(mergeAircraftResponses([resp(real), resp(noSeen)])[0].flight).toBe('REAL')
  })

  it('breaks a seen tie on seen_pos where a missing seen_pos loses', () => {
    const noPos = ac('abc123', 3.0, undefined, { flight: 'NOPOS' })
    const withPos = ac('abc123', 3.0, 9.0, { flight: 'WITHPOS' })
    expect(mergeAircraftResponses([resp(noPos), resp(withPos)])[0].flight).toBe('WITHPOS')
  })

  it('unions distinct hexes across clusters', () => {
    const merged = mergeAircraftResponses([resp(ac('aaa', 1)), resp(ac('bbb', 1)), resp(ac('ccc', 1))])
    expect(merged.map((a) => a.hex).sort()).toEqual(['aaa', 'bbb', 'ccc'])
  })

  it('tolerates null / undefined responses and a response with a null ac array', () => {
    const merged = mergeAircraftResponses([
      null,
      resp(ac('aaa', 1)),
      undefined,
      { ac: null as unknown as AdsbAircraft[], total: 0, ctime: 0, ptime: 0 },
      resp(ac('bbb', 1)),
    ])
    expect(merged.map((a) => a.hex).sort()).toEqual(['aaa', 'bbb'])
  })

  it('passes a single response through (all aircraft, deduped)', () => {
    const single = resp(ac('aaa', 1), ac('bbb', 2), ac('ccc', 3))
    const merged = mergeAircraftResponses([single])
    expect(merged.map((a) => a.hex).sort()).toEqual(['aaa', 'bbb', 'ccc'])
  })

  it('returns an empty array for no responses (or all empty)', () => {
    expect(mergeAircraftResponses([])).toEqual([])
    expect(mergeAircraftResponses([null, undefined])).toEqual([])
    expect(mergeAircraftResponses([resp()])).toEqual([])
  })
})
