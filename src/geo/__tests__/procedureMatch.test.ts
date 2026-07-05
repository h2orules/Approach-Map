import { describe, it, expect } from 'vitest'
import { evaluateMatch, type MatchTolerances, type AirportContext } from '../procedureMatch'
import type { Procedure, ProcedureType, WaypointSymbol, AltConstraint } from '../../types/procedure'
import type { InterpolatedAircraft } from '../../types/aircraft'

const CAND: MatchTolerances = {
  crossTrackApproachNm: 0.35,
  crossTrackSidStarNm: 0.8,
  directionToleranceDeg: 45,
  altConstrainedFt: 200,
  altNearFt: 400,
  altFarFt: 800,
}
const CONF: MatchTolerances = { ...CAND, crossTrackApproachNm: 0.6, directionToleranceDeg: 60 }

const LON = -122.31
const CTX: AirportContext = { lat: 47.4, lon: LON, elevationFt: 0 }

interface WptSpec {
  id: string
  lat: number
  alt?: AltConstraint | null
}

function makeProc(
  type: ProcedureType,
  wpts: WptSpec[],
  symbols: WaypointSymbol[] = [],
): Procedure {
  return {
    id: `KSEA-${type}`,
    icao: 'KSEA',
    name: type === 'APPROACH' ? 'I16C' : 'TEST1',
    type,
    runways: ['16C'],
    waypoints: wpts.map((w, i) => ({
      id: w.id,
      lat: w.lat,
      lon: LON,
      navaidType: 'FIX',
      altConstraint: w.alt ?? null,
      sequenceNumber: (i + 1) * 10,
    })),
    symbols,
    geojson: { type: 'FeatureCollection', features: [] },
    hasGeometry: true,
    color: '#34d399',
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
    baroRate: -500,
    squawk: '1200',
    lastPollMs: 0,
    interpLat: lat,
    interpLon: lon,
    ...over,
  }
}

// A southbound approach (north fix → south fix), no constraints/symbols.
const southbound = makeProc('APPROACH', [
  { id: 'NORTH', lat: 47.5 },
  { id: 'SOUTH', lat: 47.4 },
])

describe('evaluateMatch direction gating (ported)', () => {
  it('matches an aircraft flying the procedure direction (southbound)', () => {
    expect(evaluateMatch(aircraft({ track: 180 }), southbound, CTX, CAND)).not.toBeNull()
  })

  it('rejects the reciprocal (northbound) on the same centerline', () => {
    expect(evaluateMatch(aircraft({ track: 0 }), southbound, CTX, CAND)).toBeNull()
  })

  it('rejects a track well off the procedure direction (>90°)', () => {
    expect(evaluateMatch(aircraft({ track: 300 }), southbound, CTX, CAND)).toBeNull()
  })
})

describe('evaluateMatch altitude evidence', () => {
  it('projects the glideslope past the FAF (fafAlt − d×318)', () => {
    const faf: WaypointSymbol = {
      id: 'FAFXX',
      lat: 47.5,
      lon: LON,
      navaidType: 'FIX',
      role: 'faf',
      alt: { type: 'AT', low: 1800 },
      speedKt: null,
      gsFaf: true,
      flyover: false,
    }
    const proc = makeProc(
      'APPROACH',
      [
        { id: 'FAFXX', lat: 47.5, alt: { type: 'AT', low: 1800 } },
        { id: 'RWY', lat: 47.4 },
      ],
      [faf],
    )
    // 3 nm south of the FAF → expected 1800 − 3×318 = 846 ft.
    const onGs = evaluateMatch(aircraft({ interpLat: 47.45, altBaro: 846 }), proc, CTX, CAND)
    expect(onGs?.altOk).toBe(true)
    const highOnGs = evaluateMatch(aircraft({ interpLat: 47.45, altBaro: 1300 }), proc, CTX, CAND)
    expect(highOnGs).not.toBeNull()
    expect(highOnGs?.altOk).toBe(false)
  })

  it('interpolates linearly between two AT constraints (tight tolerance)', () => {
    const proc = makeProc('STAR', [
      { id: 'HI', lat: 47.5, alt: { type: 'AT', low: 4000 } },
      { id: 'LO', lat: 47.4, alt: { type: 'AT', low: 2000 } },
    ])
    // Midpoint → 3000 ft expected; 200 ft tight tolerance.
    expect(evaluateMatch(aircraft({ altBaro: 3000 }), proc, CTX, CAND)?.altOk).toBe(true)
    expect(evaluateMatch(aircraft({ altBaro: 3350 }), proc, CTX, CAND)?.altOk).toBe(false)
  })

  it('uses the loose fallback tolerance for AT_OR_ABOVE bracketing', () => {
    const proc = makeProc('STAR', [
      { id: 'HI', lat: 47.5, alt: { type: 'AT_OR_ABOVE', low: 4000 } },
      { id: 'LO', lat: 47.4, alt: { type: 'AT_OR_ABOVE', low: 2000 } },
    ])
    // 350 ft off midpoint: fails the 200 ft tight band, passes the 400 ft near band.
    expect(evaluateMatch(aircraft({ altBaro: 3350 }), proc, CTX, CAND)?.altOk).toBe(true)
  })

  it('falls back to AGL plausibility when no constraints bracket the segment', () => {
    expect(evaluateMatch(aircraft({ altBaro: 3000 }), southbound, CTX, CAND)?.altOk).toBe(true)
    expect(evaluateMatch(aircraft({ altBaro: 15000 }), southbound, CTX, CAND)?.altOk).toBe(false)
  })
})

describe('evaluateMatch MAP flags', () => {
  const map: WaypointSymbol = {
    id: 'MAPWP',
    lat: 47.45,
    lon: LON,
    navaidType: 'FIX',
    role: 'map',
    alt: null,
    speedKt: null,
    gsFaf: false,
    flyover: false,
  }
  const proc = makeProc(
    'APPROACH',
    [
      { id: 'FAFXX', lat: 47.5 },
      { id: 'MAPWP', lat: 47.45 },
      { id: 'RWY', lat: 47.4 },
    ],
    [map],
  )

  it('reports preMap before the MAP waypoint', () => {
    const ev = evaluateMatch(aircraft({ interpLat: 47.48 }), proc, CTX, CAND)
    expect(ev?.preMap).toBe(true)
    expect(ev?.pastMap).toBe(false)
  })

  it('reports pastMap at/after the MAP waypoint', () => {
    const ev = evaluateMatch(aircraft({ interpLat: 47.42 }), proc, CTX, CAND)
    expect(ev?.preMap).toBe(false)
    expect(ev?.pastMap).toBe(true)
  })
})

describe('evaluateMatch tolerance widening', () => {
  it('rejects at candidate cross-track but accepts at confirmed cross-track', () => {
    // ~0.45 nm east of the centerline at lat 47.45.
    const ac = aircraft({ interpLon: LON + 0.01108 })
    expect(evaluateMatch(ac, southbound, CTX, CAND)).toBeNull()
    expect(evaluateMatch(ac, southbound, CTX, CONF)).not.toBeNull()
  })
})
