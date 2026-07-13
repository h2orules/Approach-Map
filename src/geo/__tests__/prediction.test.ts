import { describe, it, expect } from 'vitest'
import * as turf from '@turf/turf'
import {
  turnRateDps,
  isOnProcedureNow,
  prepareGuidance,
  predictPath,
} from '../prediction'
import { holdTrack } from '../procedureShapes'
import {
  PREDICT_STEP_S,
  PREDICT_TURN_HOLD_S,
  PREDICT_TURN_DECAY_END_S,
} from '../../config/constants'
import type {
  Procedure,
  ProcedureLeg,
  AltConstraint,
  WaypointRole,
} from '../../types/procedure'
import type { InterpolatedAircraft } from '../../types/aircraft'
import type { TrackPoint } from '../../types/path'

// ── Fixtures (north-south corridor, mirrors procedureMatch.test.ts) ──────────

const LON = -122.31

interface WptSpec {
  id: string
  lat: number
  role?: WaypointRole
  alt?: AltConstraint | null
}

function leg(spec: WptSpec, over: Partial<ProcedureLeg> = {}): ProcedureLeg {
  return {
    seq: 10,
    fixId: spec.id,
    lat: spec.lat,
    lon: LON,
    navaidType: 'FIX',
    altConstraint: spec.alt ?? null,
    pathTerm: 'TF',
    role: spec.role ?? 'normal',
    flyover: false,
    turnRight: true,
    course: 180,
    legNm: 0,
    speedKt: 0,
    dmeNm: null,
    recNavId: '',
    ...over,
  }
}

/** A southbound approach (fixes north → south) with a final/common transition. */
function approachProc(wpts: WptSpec[]): Procedure {
  return {
    id: 'KSEA-APPROACH',
    icao: 'KSEA',
    name: 'I16C',
    type: 'APPROACH',
    runways: ['16C'],
    waypoints: wpts.map((w, i) => ({
      id: w.id,
      lat: w.lat,
      lon: LON,
      navaidType: 'FIX' as const,
      altConstraint: w.alt ?? null,
      sequenceNumber: (i + 1) * 10,
    })),
    symbols: wpts
      .filter((w) => w.role === 'faf' || w.role === 'map')
      .map((w) => ({
        id: w.id,
        lat: w.lat,
        lon: LON,
        navaidType: 'FIX' as const,
        role: w.role as WaypointRole,
        alt: w.alt ?? null,
        speedKt: null,
        gsFaf: w.role === 'faf',
        flyover: false,
      })),
    geojson: { type: 'FeatureCollection', features: [] },
    hasGeometry: true,
    color: '#34d399',
    transitions: [{ id: '(final)', legs: wpts.map((w) => leg(w)) }],
  }
}

function aircraft(over: Partial<InterpolatedAircraft>): InterpolatedAircraft {
  const lat = over.interpLat ?? 47.45
  const lon = over.interpLon ?? LON
  return {
    hex: 'abc123',
    flight: 'TEST1',
    registration: 'N1',
    typeCode: 'B738',
    lat,
    lon,
    altBaro: 3000,
    altGeom: 3000,
    groundspeed: 180,
    track: 180,
    baroRate: 0,
    squawk: '1200',
    lastPollMs: 0,
    interpLat: lat,
    interpLon: lon,
    ...over,
  }
}

/** Build a chronological tracklog from a series of tracks at fixed Δt. */
function samples(tracks: number[], dtS: number): TrackPoint[] {
  return tracks.map((track, i) => ({
    tMs: i * dtS * 1000,
    lat: 47.45,
    lon: LON,
    altFt: 3000,
    gs: 180,
    track,
    baroRate: 0,
  }))
}

// ── turnRateDps ──────────────────────────────────────────────────────────────

describe('turnRateDps', () => {
  it('is positive for a right (increasing-heading) turn', () => {
    expect(turnRateDps(samples([100, 110, 120], 5))).toBeCloseTo(2, 5)
  })

  it('is negative for a left (decreasing-heading) turn', () => {
    expect(turnRateDps(samples([120, 110, 100], 5))).toBeCloseTo(-2, 5)
  })

  it('handles the 360 wrap (355 -> 5 is +10 deg)', () => {
    // Two samples, 5 s apart: +10 deg over 5 s = +2 deg/s.
    expect(turnRateDps(samples([355, 5], 5))).toBeCloseTo(2, 5)
  })

  it('weights the most recent pair double', () => {
    // Pair 1: +5/5 = 1 deg/s (weight 1). Pair 2: +15/5 = 3 deg/s (weight 2).
    // Weighted mean = (1*1 + 3*2) / 3 = 7/3.
    expect(turnRateDps(samples([100, 105, 120], 5))).toBeCloseTo(7 / 3, 5)
  })

  it('returns 0 for a single sample', () => {
    expect(turnRateDps(samples([90], 5))).toBe(0)
  })

  it('skips pairs whose dt is outside [1, 20] s', () => {
    // First pair spans 30 s (skipped); only the 5 s pair (+10/5 = 2) counts.
    const pts: TrackPoint[] = [
      { tMs: 0, lat: 47.45, lon: LON, altFt: 3000, gs: 180, track: 90, baroRate: 0 },
      { tMs: 30_000, lat: 47.45, lon: LON, altFt: 3000, gs: 180, track: 100, baroRate: 0 },
      { tMs: 35_000, lat: 47.45, lon: LON, altFt: 3000, gs: 180, track: 110, baroRate: 0 },
    ]
    expect(turnRateDps(pts)).toBeCloseTo(2, 5)
  })
})

// ── Extrapolation modes ──────────────────────────────────────────────────────

function bearingBetween(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  return turf.bearing(turf.point([a.lon, a.lat]), turf.point([b.lon, b.lat]))
}

describe('predictPath — straight extrapolation', () => {
  it('below the turn-rate floor flies a straight, constant-bearing line', () => {
    // ~0.1 deg/s of jitter (< 0.5 floor) -> treated as straight.
    const path = predictPath(aircraft({ track: 90 }), samples([89.7, 89.85, 90], 5), null, 0)
    expect(path.mode).toBe('straight')
    for (let i = 2; i < path.points.length; i++) {
      const brg = bearingBetween(path.points[i - 1], path.points[i])
      expect(bearingDeltaAbs(brg, 90)).toBeLessThan(0.5)
    }
  })

  it('spaces points by groundspeed * step along-track', () => {
    const path = predictPath(aircraft({ groundspeed: 180 }), samples([180, 180, 180], 5), null, 0)
    // 180 kt over 5 s = 0.25 nm.
    const d = turf.distance(
      turf.point([path.points[0].lon, path.points[0].lat]),
      turf.point([path.points[1].lon, path.points[1].lat]),
      { units: 'nauticalmiles' },
    )
    expect(d).toBeCloseTo(0.25, 2)
  })
})

function bearingDeltaAbs(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

describe('predictPath — turning extrapolation', () => {
  it('stops accruing heading change after the decay window', () => {
    const path = predictPath(aircraft({ track: 90 }), samples([80, 85, 90], 5), null, 0, 300)
    // Compare consecutive-segment bearings; after PREDICT_TURN_DECAY_END_S they
    // must be identical (no further turn).
    const brgAt = (t: number) => {
      const i = t / PREDICT_STEP_S
      return bearingBetween(path.points[i], path.points[i + 1])
    }
    const bAfter = brgAt(PREDICT_TURN_DECAY_END_S + PREDICT_STEP_S * 2)
    const bLate = brgAt(280)
    expect(bearingDeltaAbs(bAfter, bLate)).toBeLessThan(0.5)
  })

  it('total heading change approximates omega*(HOLD + (DECAY-HOLD)/2)', () => {
    // +5 deg over 5 s per pair -> omega = +1 deg/s (right turn).
    const path = predictPath(aircraft({ track: 90 }), samples([80, 85, 90], 5), null, 0, 300)
    const first = bearingBetween(path.points[0], path.points[1])
    const settled = bearingBetween(path.points[58], path.points[59]) // ~t=290
    const totalTurn = ((settled - first + 540) % 360) - 180
    const omega = 1
    const analytic = omega * (PREDICT_TURN_HOLD_S + (PREDICT_TURN_DECAY_END_S - PREDICT_TURN_HOLD_S) / 2)
    // Discrete Euler over-counts the ramp slightly; allow generous tolerance.
    expect(totalTurn).toBeGreaterThan(analytic * 0.75)
    expect(totalTurn).toBeLessThan(analytic * 1.25)
    expect(totalTurn).toBeGreaterThan(0)
  })

  it('rolls out to straight once the samples show no turn', () => {
    const path = predictPath(aircraft({ track: 90 }), samples([90, 90, 90], 5), null, 0)
    expect(path.mode).toBe('straight')
  })

  it('forces straight for a noisy TIS-B (~) track despite a turning history', () => {
    const path = predictPath(
      aircraft({ hex: '~abc123', track: 90 }),
      samples([80, 85, 90], 5),
      null,
      0,
    )
    expect(path.mode).toBe('straight')
  })
})

describe('predictPath — vertical extrapolation', () => {
  it('descends at the baro rate and floors at field elevation', () => {
    const path = predictPath(
      aircraft({ altBaro: 3000, baroRate: -1000, track: 90 }),
      samples([90, 90, 90], 5),
      null,
      500,
      300,
    )
    // Reaches 500 at t = (3000-500)/1000 * 60 = 150 s, then holds.
    const altAt = (t: number) => path.points[t / PREDICT_STEP_S].altFt
    expect(altAt(60)).toBeCloseTo(2000, 0)
    expect(altAt(150)).toBeCloseTo(500, 0)
    expect(altAt(200)).toBe(500)
    expect(altAt(300)).toBe(500)
  })
})

// ── Approach following ───────────────────────────────────────────────────────

describe('predictPath — approach following', () => {
  const proc = approachProc([
    { id: 'FAFXX', lat: 47.6, role: 'faf', alt: { type: 'AT', low: 3000 } },
    { id: 'MAPXX', lat: 47.4, role: 'map' },
  ])
  const FIELD = 500

  it('stays on the corridor and rides the descent profile', () => {
    const guidance = prepareGuidance(proc, null, FIELD)
    // Place the aircraft on the corridor between the FAF and the MAP, at the
    // profile altitude for its position so it captures immediately.
    const acLat = 47.55
    const along = turf.distance(
      turf.point([LON, 47.6]),
      turf.point([LON, acLat]),
      { units: 'nauticalmiles' },
    )
    const total = turf.distance(
      turf.point([LON, 47.6]),
      turf.point([LON, 47.4]),
      { units: 'nauticalmiles' },
    )
    // Profile: 3000 at the FAF -> field+50 at the runway, linear.
    const startAlt = 3000 + (FIELD + 50 - 3000) * (along / total)
    const ac = aircraft({
      interpLat: acLat,
      interpLon: LON,
      track: 180,
      groundspeed: 180,
      altBaro: Math.round(startAlt),
      baroRate: -600,
    })
    const path = predictPath(ac, samples([180, 180, 180], 5), guidance, FIELD)
    expect(path.mode).toBe('approach')

    // Lateral: every point sits on the LON corridor.
    for (const p of path.points) {
      expect(Math.abs(p.lon - LON)).toBeLessThan(0.001)
    }
    // Along-track spacing: 180 kt over 5 s = 0.25 nm.
    const d = turf.distance(
      turf.point([path.points[1].lon, path.points[1].lat]),
      turf.point([path.points[2].lon, path.points[2].lat]),
      { units: 'nauticalmiles' },
    )
    expect(d).toBeCloseTo(0.25, 2)

    // Vertical: each point rides the profile within ~50 ft (until it runs off
    // the end of the descent, where it holds the runway-crossing altitude).
    for (let i = 1; i < path.points.length; i++) {
      const p = path.points[i]
      const distFromFaf = turf.distance(
        turf.point([LON, 47.6]),
        turf.point([p.lon, p.lat]),
        { units: 'nauticalmiles' },
      )
      const clamped = Math.min(distFromFaf, total)
      const expected = 3000 + (FIELD + 50 - 3000) * (clamped / total)
      expect(Math.abs(p.altFt - expected)).toBeLessThan(50)
      expect(p.altFt).toBeGreaterThanOrEqual(FIELD - 0.01)
    }
  })

  it('un-snaps to turn extrapolation when off course despite an assignment', () => {
    const guidance = prepareGuidance(proc, null, FIELD)
    // Well east of the corridor and turning -> not on any guidance path.
    const ac = aircraft({
      interpLat: 47.5,
      interpLon: LON + 0.2,
      track: 90,
      baroRate: 0,
    })
    const path = predictPath(ac, samples([80, 85, 90], 5), guidance, FIELD)
    expect(path.mode).toBe('turn')
  })
})

// ── isOnProcedureNow ─────────────────────────────────────────────────────────

describe('isOnProcedureNow', () => {
  const proc = approachProc([
    { id: 'NORTH', lat: 47.5 },
    { id: 'SOUTH', lat: 47.4 },
  ])

  it('is true for an aircraft on course flying the procedure direction', () => {
    expect(isOnProcedureNow(aircraft({ interpLat: 47.45, track: 180 }), proc)).toBe(true)
  })

  it('is false when the track is 90 deg off the segment', () => {
    expect(isOnProcedureNow(aircraft({ interpLat: 47.45, track: 90 }), proc)).toBe(false)
  })

  it('is true within the roomier hold tolerance when closest to a hold path', () => {
    const hp = holdProc()
    const { lat, lon, track } = holdOutboundPoint()
    // Track 70 deg off the hold segment: fails the 60 deg final gate but passes
    // the 75 deg hold gate, and the aircraft is closest to the hold racetrack.
    expect(isOnProcedureNow(aircraft({ interpLat: lat, interpLon: lon, track: (track + 70) % 360 }), hp)).toBe(true)
  })
})

const HOLD_FIX = { lat: 47.5, lon: -122.3 }

function holdProc(): Procedure {
  const track = holdTrack(HOLD_FIX.lat, HOLD_FIX.lon, 360, true, 4)
  const wpt = (id: string, lat: number) => ({
    id,
    lat,
    lon: HOLD_FIX.lon,
    navaidType: 'FIX' as const,
    altConstraint: null,
    sequenceNumber: 10,
  })
  return {
    id: 'KSEA-APPROACH-HOLD',
    icao: 'KSEA',
    name: 'R16C',
    type: 'APPROACH',
    runways: ['16C'],
    waypoints: [wpt('HOLDF', HOLD_FIX.lat), wpt('RWY', HOLD_FIX.lat - 0.1)],
    symbols: [],
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: track },
          properties: { kind: 'hold', segment: 'transition', fixId: 'HOLDF', alt: null },
        },
      ],
    },
    hasGeometry: true,
    color: '#34d399',
  }
}

// Easternmost racetrack vertex (on the outbound leg), and its local tangent.
function holdOutboundPoint(): { lat: number; lon: number; track: number } {
  const track = holdTrack(HOLD_FIX.lat, HOLD_FIX.lon, 360, true, 4)
  let idx = 0
  track.forEach((p, i) => {
    if (p[0] > track[idx][0]) idx = i
  })
  const nxt = track[(idx + 1) % track.length]
  return {
    lat: track[idx][1],
    lon: track[idx][0],
    track: turf.bearing(turf.point(track[idx]), turf.point(nxt)),
  }
}
