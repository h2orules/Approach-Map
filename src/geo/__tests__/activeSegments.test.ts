import { describe, it, expect } from 'vitest'
import type { Feature, LineString } from 'geojson'
import { findActiveSegments } from '../activeSegments'
import type { Procedure, ProcedureType } from '../../types/procedure'
import type { InterpolatedAircraft } from '../../types/aircraft'

const LON = -122.3
// A north→south corridor: A (north) → B (mid) → C (south).
const A: [number, number] = [LON, 47.6]
const B: [number, number] = [LON, 47.5]
const C: [number, number] = [LON, 47.4]

function pathFeat(coords: [number, number][], props: Record<string, unknown>): Feature<LineString> {
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: props }
}

/** A procedure with an explicit feeder leg (A→B) and a final leg (B→C). */
function proc(type: ProcedureType, opts: { feederOnFirst?: boolean } = {}): Procedure {
  const feederOnFirst = opts.feederOnFirst ?? true
  return {
    id: `KSEA-${type}`,
    icao: 'KSEA',
    name: type === 'APPROACH' ? 'I16C' : 'TEST1',
    type,
    runways: ['16C'],
    waypoints: [],
    symbols: [],
    geojson: {
      type: 'FeatureCollection',
      features: [
        pathFeat([A, B], { kind: 'path', segment: 'transition', transitionId: 'FEED', ...(feederOnFirst ? { feeder: true } : {}) }),
        pathFeat([B, C], { kind: 'path', segment: 'transition', transitionId: '(common)' }),
      ],
    },
    hasGeometry: true,
    color: '#34d399',
  }
}

function aircraft(over: Partial<InterpolatedAircraft>): InterpolatedAircraft {
  const lat = over.interpLat ?? 47.55
  const lon = over.interpLon ?? LON
  return {
    hex: 'abc123', flight: 'T', registration: 'N1', typeCode: 'B738',
    lat, lon, altBaro: 3000, altGeom: 3000, groundspeed: 180, track: 180, baroRate: 0,
    squawk: '2000', lastPollMs: 0, interpLat: lat, interpLon: lon, ...over,
  }
}

describe('findActiveSegments — approach feeders', () => {
  it('highlights an aircraft flying an approach feeder leg', () => {
    // Southbound on the A→B feeder (lat 47.55 is between A and B).
    const fc = findActiveSegments([aircraft({ interpLat: 47.55, track: 180 })], [proc('APPROACH')], null)
    expect(fc.features.length).toBe(1)
    expect((fc.features[0].properties as { color: string }).color).toBe('#34d399')
  })

  it('does NOT highlight an aircraft on the approach FINAL (non-feeder) leg', () => {
    // Southbound on the B→C final leg (lat 47.45). Approaches only thicken
    // feeder legs — the final keeps its own detection-driven width.
    const fc = findActiveSegments([aircraft({ interpLat: 47.45, track: 180 })], [proc('APPROACH')], null)
    expect(fc.features.length).toBe(0)
  })

  it('still highlights every flown leg of a SID/STAR (feeder tag irrelevant)', () => {
    // The same B→C leg on a STAR IS highlighted (no feeder gating for SID/STAR).
    const fc = findActiveSegments([aircraft({ interpLat: 47.45, track: 180 })], [proc('STAR', { feederOnFirst: false })], null)
    expect(fc.features.length).toBe(1)
  })

  it('excludes the selected aircraft (its leg is drawn by FlownSegmentLayer)', () => {
    const ac = aircraft({ hex: 'sel1', interpLat: 47.55, track: 180 })
    expect(findActiveSegments([ac], [proc('APPROACH')], 'sel1').features.length).toBe(0)
  })
})

// ── Hold racetrack thickening ───────────────────────────────────────────────
import { holdTrack } from '../procedureShapes'
import * as turf from '@turf/turf'

const HFIX = { lat: 47.5, lon: -122.3 }

function holdProc(): Procedure {
  const track = holdTrack(HFIX.lat, HFIX.lon, 360, true, 4)
  return {
    id: 'KSEA-APPROACH-HOLD', icao: 'KSEA', name: 'R16C', type: 'APPROACH', runways: ['16C'],
    waypoints: [], symbols: [],
    geojson: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: track }, properties: { kind: 'hold', segment: 'transition' } }],
    },
    hasGeometry: true, color: '#f0abfc',
  }
}

// A point on the racetrack outbound leg + its tangent (as the detector sees a
// holding aircraft).
function onRacetrack(): { lat: number; lon: number; track: number } {
  const track = holdTrack(HFIX.lat, HFIX.lon, 360, true, 4)
  let idx = 0
  track.forEach((p, i) => { if (p[0] > track[idx][0]) idx = i })
  const nxt = track[(idx + 1) % track.length]
  return { lat: track[idx][1], lon: track[idx][0], track: turf.bearing(turf.point(track[idx]), turf.point(nxt)) }
}

describe('findActiveSegments — hold racetracks', () => {
  it('emits the WHOLE racetrack (not one leg) when an aircraft is flying the hold', () => {
    const { lat, lon, track } = onRacetrack()
    const fc = findActiveSegments([aircraft({ interpLat: lat, interpLon: lon, track })], [holdProc()], null)
    expect(fc.features.length).toBe(1)
    // Whole racetrack, not a 2-point segment.
    expect((fc.features[0].geometry as { coordinates: unknown[] }).coordinates.length).toBeGreaterThan(6)
    expect((fc.features[0].properties as { color: string }).color).toBe('#f0abfc')
  })

  it('emits nothing when no aircraft is flying the hold', () => {
    const fc = findActiveSegments([aircraft({ interpLat: 47.5, interpLon: -122.0, track: 360 })], [holdProc()], null)
    expect(fc.features.length).toBe(0)
  })

  it('thickens the hold even for the selected aircraft (unlike per-leg highlights)', () => {
    const { lat, lon, track } = onRacetrack()
    const ac = aircraft({ hex: 'sel1', interpLat: lat, interpLon: lon, track })
    expect(findActiveSegments([ac], [holdProc()], 'sel1').features.length).toBe(1)
  })
})
