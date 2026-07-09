import { describe, it, expect } from 'vitest'
import { computeProcedureBbox, isInsideBbox, getProcedureBbox } from '../procedureBbox'
import { evaluateMatch, type AirportContext, type MatchTolerances } from '../procedureMatch'
import type { Procedure } from '../../types/procedure'
import type { InterpolatedAircraft } from '../../types/aircraft'
import {
  DETECT_CANDIDATE_XT_APPROACH_NM,
  DETECT_CANDIDATE_DIR_DEG,
  DETECT_CANDIDATE_ALT_CONSTRAINED_FT,
  DETECT_CANDIDATE_ALT_NEAR_FT,
  DETECT_CANDIDATE_ALT_FAR_FT,
  DETECT_CONFIRMED_XT_APPROACH_NM,
  DETECT_CONFIRMED_DIR_DEG,
  NEAR_AIRPORT_DISTANCE_NM,
  DETECT_BBOX_PAD_NM,
} from '../../config/constants'

// The pad the detection reducer actually uses for its new-track prefilter.
const REDUCER_PAD = NEAR_AIRPORT_DISTANCE_NM + DETECT_BBOX_PAD_NM // 6 nm

/**
 * Minimal geometric procedure. Waypoints on a vertical (constant-lon) line
 * between two lats, matching the shape the detection fixtures use.
 */
function lineProc(
  pts: Array<[number, number]>,
  opts: { hasGeometry?: boolean } = {},
): Procedure {
  return {
    id: 'P',
    icao: 'KSEA',
    name: 'P',
    type: 'APPROACH',
    runways: ['16C'],
    waypoints: pts.map(([lat, lon], i) => ({
      id: `W${i}`,
      lat,
      lon,
      navaidType: 'FIX',
      altConstraint: null,
      sequenceNumber: (i + 1) * 10,
    })),
    symbols: [],
    geojson: { type: 'FeatureCollection', features: [] },
    hasGeometry: opts.hasGeometry ?? true,
    color: '#34d399',
  }
}

describe('computeProcedureBbox', () => {
  it('returns null for a single-waypoint procedure (< 2 points)', () => {
    expect(computeProcedureBbox(lineProc([[47.5, -122.3]]), 1)).toBeNull()
  })

  it('returns null when the procedure has no geometry', () => {
    expect(
      computeProcedureBbox(lineProc([[47.6, -122.3], [47.3, -122.3]], { hasGeometry: false }), 1),
    ).toBeNull()
  })

  it('spans the waypoint extent and pads latitude by padNm/60', () => {
    const proc = lineProc([
      [47.6, -122.35],
      [47.3, -122.25],
    ])
    const padNm = 6
    const b = computeProcedureBbox(proc, padNm)!
    const dLat = padNm / 60
    expect(b.minLat).toBeCloseTo(47.3 - dLat, 10)
    expect(b.maxLat).toBeCloseTo(47.6 + dLat, 10)
    // Longitude min/max come from the waypoints (before padding).
    expect(b.minLon).toBeLessThan(-122.35)
    expect(b.maxLon).toBeGreaterThan(-122.25)
  })

  it('divides the longitude pad by cos(maxAbsLat) — wider in degrees than the lat pad away from the equator', () => {
    const proc = lineProc([
      [47.6, -122.3],
      [47.3, -122.3],
    ])
    const padNm = 6
    const b = computeProcedureBbox(proc, padNm)!
    const dLat = padNm / 60
    const cosLat = Math.cos((47.6 * Math.PI) / 180)
    const expectedDLon = padNm / (60 * cosLat)
    expect(b.maxLon - -122.3).toBeCloseTo(expectedDLon, 10)
    expect(-122.3 - b.minLon).toBeCloseTo(expectedDLon, 10)
    // cos(47.6°) < 1 → the lon pad in degrees is strictly wider than the lat pad.
    expect(expectedDLon).toBeGreaterThan(dLat)
  })

  it('uses the box MAXIMUM |lat| for the cos correction (conservative box)', () => {
    // Two boxes with the same pad but different max |lat|: the higher-latitude
    // box gets the larger lon pad (smaller cos → larger pad).
    const low = computeProcedureBbox(lineProc([[10, 0], [11, 0]]), 6)!
    const high = computeProcedureBbox(lineProc([[60, 0], [61, 0]]), 6)!
    const lowPad = low.maxLon - 0 // waypoints at lon 0
    const highPad = high.maxLon - 0
    expect(highPad).toBeGreaterThan(lowPad)
  })

  it('clamps cos to a small floor near the poles (finite pad, no blow-up)', () => {
    const b = computeProcedureBbox(lineProc([[89.99, 0], [89.98, 0]]), 6)!
    // cos clamped to 0.01 → dLon = 6 / (60 * 0.01) = 10°, finite.
    expect(b.maxLon).toBeCloseTo(6 / (60 * 0.01), 6)
    expect(Number.isFinite(b.maxLon)).toBe(true)
  })

  it('grows with a larger pad', () => {
    const proc = lineProc([[47.6, -122.3], [47.3, -122.3]])
    const small = computeProcedureBbox(proc, 1)!
    const large = computeProcedureBbox(proc, 6)!
    expect(large.maxLat).toBeGreaterThan(small.maxLat)
    expect(large.minLat).toBeLessThan(small.minLat)
    expect(large.maxLon).toBeGreaterThan(small.maxLon)
    expect(large.minLon).toBeLessThan(small.minLon)
  })
})

describe('isInsideBbox', () => {
  const b = { minLat: 47, maxLat: 48, minLon: -123, maxLon: -122 }

  it('is true strictly inside', () => {
    expect(isInsideBbox(b, 47.5, -122.5)).toBe(true)
  })

  it('is inclusive on every edge and corner', () => {
    expect(isInsideBbox(b, 47, -122.5)).toBe(true)
    expect(isInsideBbox(b, 48, -122.5)).toBe(true)
    expect(isInsideBbox(b, 47.5, -123)).toBe(true)
    expect(isInsideBbox(b, 47.5, -122)).toBe(true)
    expect(isInsideBbox(b, 47, -123)).toBe(true)
  })

  it('is false just outside each side', () => {
    expect(isInsideBbox(b, 46.999, -122.5)).toBe(false)
    expect(isInsideBbox(b, 48.001, -122.5)).toBe(false)
    expect(isInsideBbox(b, 47.5, -123.001)).toBe(false)
    expect(isInsideBbox(b, 47.5, -121.999)).toBe(false)
  })
})

describe('getProcedureBbox (memoized)', () => {
  it('returns the identical object on repeated calls for the same procedure', () => {
    const proc = lineProc([[47.6, -122.3], [47.3, -122.3]])
    const a = getProcedureBbox(proc, REDUCER_PAD)
    const b = getProcedureBbox(proc, REDUCER_PAD)
    expect(a).not.toBeNull()
    expect(a).toBe(b) // reference identity from the WeakMap cache
  })

  it('caches the null result for a geometry-less procedure', () => {
    const proc = lineProc([[47.6, -122.3]])
    expect(getProcedureBbox(proc, REDUCER_PAD)).toBeNull()
    expect(getProcedureBbox(proc, REDUCER_PAD)).toBeNull()
  })
})

// ── Prefilter soundness: any point that yields cross-track evidence from
//    evaluateMatch is inside the reducer's padded box. This is the contract that
//    lets the reducer skip the line-matching math for out-of-box aircraft
//    without ever changing a result. ────────────────────────────────────────
describe('bbox soundness vs evaluateMatch', () => {
  const ctx: AirportContext = { lat: 47.45, lon: -122.31, elevationFt: 0 }
  const candidateTol: MatchTolerances = {
    crossTrackApproachNm: DETECT_CANDIDATE_XT_APPROACH_NM,
    crossTrackSidStarNm: DETECT_CANDIDATE_XT_APPROACH_NM,
    directionToleranceDeg: DETECT_CANDIDATE_DIR_DEG,
    altConstrainedFt: DETECT_CANDIDATE_ALT_CONSTRAINED_FT,
    altNearFt: DETECT_CANDIDATE_ALT_NEAR_FT,
    altFarFt: DETECT_CANDIDATE_ALT_FAR_FT,
  }
  const confirmedTol: MatchTolerances = {
    ...candidateTol,
    crossTrackApproachNm: DETECT_CONFIRMED_XT_APPROACH_NM,
    directionToleranceDeg: DETECT_CONFIRMED_DIR_DEG,
  }

  const proc = lineProc([
    [47.6, -122.31],
    [47.3, -122.31],
  ])
  const bbox = computeProcedureBbox(proc, REDUCER_PAD)!

  function plane(lat: number, lon: number, track: number): InterpolatedAircraft {
    return {
      hex: 'a',
      flight: 'A',
      registration: 'N1',
      typeCode: 'B738',
      lat,
      lon,
      altBaro: 3000,
      altGeom: 3000,
      groundspeed: 180,
      track,
      baroRate: -500,
      squawk: '3471',
      lastPollMs: 0,
      interpLat: lat,
      interpLon: lon,
    }
  }

  it('every position that produces evidence is inside the padded box (both tolerances, both directions)', () => {
    let evidenceCount = 0
    // Sweep a wide grid spanning far past the box, at several tracks.
    for (let lat = 46.8; lat <= 48.1; lat += 0.05) {
      for (let lon = -122.7; lon <= -121.9; lon += 0.01) {
        for (const track of [0, 90, 180, 270]) {
          const ac = plane(lat, lon, track)
          const ev =
            evaluateMatch(ac, proc, ctx, candidateTol) ?? evaluateMatch(ac, proc, ctx, confirmedTol)
          if (ev) {
            evidenceCount++
            expect(isInsideBbox(bbox, lat, lon)).toBe(true)
          }
        }
      }
    }
    // Sanity: the sweep actually exercised the matching path.
    expect(evidenceCount).toBeGreaterThan(0)
  })

  it('a position far outside the box yields no evidence', () => {
    const farAc = plane(47.45, -121.0, 180) // ~55 nm east of the line
    expect(isInsideBbox(bbox, 47.45, -121.0)).toBe(false)
    expect(evaluateMatch(farAc, proc, ctx, confirmedTol)).toBeNull()
  })
})
