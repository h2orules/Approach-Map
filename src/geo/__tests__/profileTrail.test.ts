import { describe, it, expect } from 'vitest'
import { buildProfileTrail } from '../profileTrail'
import type { TrackPoint } from '../../types/path'
import type { ProcedureLeg, ProcedureTransition } from '../../types/procedure'
import { TRACKLOG_GAP_BREAK_MS } from '../../config/constants'

function leg(overrides: Partial<ProcedureLeg> & Pick<ProcedureLeg, 'seq' | 'fixId' | 'lat' | 'lon'>): ProcedureLeg {
  return {
    navaidType: 'FIX',
    altConstraint: null,
    pathTerm: 'CF',
    role: 'normal',
    flyover: false,
    turnRight: false,
    course: 180,
    legNm: 5,
    speedKt: 0,
    dmeNm: null,
    recNavId: '',
    ...overrides,
  }
}

// A straight north-south transition (constant longitude), ~10nm long, so
// along-track distance and cross-track offset are easy to reason about.
const START = { lat: 47.5, lon: -122.0 }
const END = { lat: 47.3333, lon: -122.0 } // ~10nm south of START

const transition: ProcedureTransition = {
  id: 'T1',
  legs: [leg({ seq: 10, fixId: 'A', ...START }), leg({ seq: 20, fixId: 'B', ...END })],
}

function point(overrides: Partial<TrackPoint>): TrackPoint {
  return { tMs: 0, lat: START.lat, lon: START.lon, altFt: 5000, gs: 120, track: 180, baroRate: 0, ...overrides }
}

describe('buildProfileTrail', () => {
  it('returns empty when the track is empty', () => {
    expect(buildProfileTrail([], transition, 10)).toEqual([])
  })

  it('drops points with a non-numeric (ground) altitude', () => {
    const track = [point({ tMs: 0, altFt: 'ground' }), point({ tMs: 1000, lat: 47.4166, altFt: 3000 })]
    const segs = buildProfileTrail(track, transition, 10)
    // Only one numeric-altitude point survives — too few to form a segment.
    expect(segs).toEqual([])
  })

  it('drops points too far cross-track from the transition line', () => {
    // ~6nm east of the line at the same latitude as START — well past the 3nm gate.
    const farLon = START.lon + 6 / (60 * Math.cos((START.lat * Math.PI) / 180))
    const track = [
      point({ tMs: 0, lat: START.lat, lon: START.lon, altFt: 5000 }),
      point({ tMs: 1000, lat: START.lat, lon: farLon, altFt: 4900 }),
      // ~1nm south of START — close enough to the first kept point that this
      // isn't also read as a distance-jump break.
      point({ tMs: 2000, lat: START.lat - 1 / 60, lon: START.lon, altFt: 4800 }),
    ]
    const segs = buildProfileTrail(track, transition, 10)
    expect(segs).toHaveLength(1)
    expect(segs[0]).toHaveLength(2)
  })

  it('drops points outside the plotted distance range', () => {
    const track = [
      point({ tMs: 0, lat: START.lat, altFt: 5000 }), // distNm ~0
      point({ tMs: 1000, lat: START.lat - 1 / 60, altFt: 4900 }), // distNm ~1, within range
      point({ tMs: 2000, lat: END.lat, altFt: 3000 }), // distNm ~10, outside the clamp
    ]
    const segs = buildProfileTrail(track, transition, 6) // clamp range shorter than the full leg
    // The last point (~10nm) falls outside [0, 6] and is dropped entirely
    // (not merely segment-broken), leaving the first two points as one segment.
    const allPts = segs.flat()
    expect(allPts.every((p) => p.distNm <= 6)).toBe(true)
    expect(allPts).toHaveLength(2)
  })

  it('breaks into segments when consecutive points are too far apart in time', () => {
    const track = [
      point({ tMs: 0, lat: START.lat, altFt: 5000 }),
      point({ tMs: 5_000, lat: 47.49, altFt: 4900 }),
      // big time gap here
      point({ tMs: 5_000 + TRACKLOG_GAP_BREAK_MS + 1, lat: 47.45, altFt: 4700 }),
      point({ tMs: 5_000 + TRACKLOG_GAP_BREAK_MS + 6_000, lat: 47.44, altFt: 4600 }),
    ]
    const segs = buildProfileTrail(track, transition, 10)
    expect(segs).toHaveLength(2)
    expect(segs[0]).toHaveLength(2)
    expect(segs[1]).toHaveLength(2)
  })

  it('breaks into segments when consecutive points jump too far in along-track distance', () => {
    const track = [
      point({ tMs: 0, lat: START.lat, altFt: 5000 }),
      point({ tMs: 1000, lat: 47.49, altFt: 4900 }),
      // Jump ~5nm south in one poll (a projection jump), well over the 2nm break.
      point({ tMs: 2000, lat: 47.41, altFt: 4400 }),
      point({ tMs: 3000, lat: 47.4, altFt: 4300 }),
    ]
    const segs = buildProfileTrail(track, transition, 10)
    expect(segs).toHaveLength(2)
  })

  it('returns empty when nothing survives the filters', () => {
    const farLon = START.lon + 6 / (60 * Math.cos((START.lat * Math.PI) / 180))
    const track = [point({ tMs: 0, lat: START.lat, lon: farLon, altFt: 5000 })]
    expect(buildProfileTrail(track, transition, 10)).toEqual([])
  })
})
