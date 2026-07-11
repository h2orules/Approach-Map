import { describe, it, expect } from 'vitest'
import * as turf from '@turf/turf'
import { evaluateMatch, buildArcMatchPaths, type MatchTolerances, type AirportContext } from '../procedureMatch'
import { dmeArc } from '../procedureShapes'
import type {
  Procedure,
  ProcedureType,
  ProcedureLeg,
  WaypointSymbol,
  AltConstraint,
} from '../../types/procedure'
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

// ── DME-arc feeder detection (KPAE VOR-A geometry) ──────────────────────────
// The VOR-A around the PAE VOR: the arc is on the ECEPO feeder transition, the
// representative/longest transition is the straight final (YAVUR→ZELIG→XUKRE),
// so an aircraft on the arc is far from the representative chord and must be
// matched via the arc feeder path. Coordinates from live FAA CIFP.
const PAE = { lat: 47.91983, lon: -122.2778 }
const YAVUR = { lat: 48.06974, lon: -122.2778 }
const ECEPO = { lat: 47.88336, lon: -122.49407 }
const ZELIG = { lat: 47.9698, lon: -122.2778 }
const XUKRE = { lat: 47.92106, lon: -122.2778 }

function arcLeg(over: Partial<ProcedureLeg> & Pick<ProcedureLeg, 'fixId' | 'lat' | 'lon'>): ProcedureLeg {
  return {
    seq: 10,
    navaidType: 'FIX',
    altConstraint: null,
    pathTerm: 'TF',
    role: 'normal',
    flyover: false,
    turnRight: true,
    course: 0,
    legNm: 0,
    speedKt: 0,
    dmeNm: null,
    recNavId: '',
    ...over,
  }
}

function vorAProc(opts: { withArc?: boolean } = {}): Procedure {
  const withArc = opts.withArc ?? true
  const finalLegs: ProcedureLeg[] = [
    arcLeg({ seq: 10, fixId: 'YAVUR', ...YAVUR, role: 'if' }),
    arcLeg({ seq: 20, fixId: 'ZELIG', ...ZELIG, role: 'faf', altConstraint: { type: 'AT_OR_ABOVE', low: 1500 } }),
    arcLeg({ seq: 30, fixId: 'XUKRE', ...XUKRE, role: 'map' }),
  ]
  const feederLegs: ProcedureLeg[] = [
    arcLeg({ seq: 10, fixId: 'ECEPO', ...ECEPO, role: 'iaf' }),
    arcLeg({
      seq: 20,
      fixId: 'YAVUR',
      ...YAVUR,
      pathTerm: 'AF',
      turnRight: true,
      altConstraint: { type: 'AT_OR_ABOVE', low: 3000 },
      ...(withArc ? { arc: { centerLat: PAE.lat, centerLon: PAE.lon } } : {}),
    }),
  ]
  return {
    id: 'KPAE-APPROACH-VOR-A',
    icao: 'KPAE',
    name: 'VOR-A',
    type: 'APPROACH',
    runways: [],
    waypoints: finalLegs.map((l) => ({
      id: l.fixId,
      lat: l.lat,
      lon: l.lon,
      navaidType: 'FIX' as const,
      altConstraint: l.altConstraint,
      sequenceNumber: l.seq,
    })),
    symbols: [
      { id: 'XUKRE', lat: XUKRE.lat, lon: XUKRE.lon, navaidType: 'FIX', role: 'map', alt: null, speedKt: null, gsFaf: false, flyover: false },
    ],
    geojson: { type: 'FeatureCollection', features: [] },
    hasGeometry: true,
    color: '#34d399',
    transitions: [
      { id: '(final)', legs: finalLegs },
      { id: 'ECEPO', legs: feederLegs },
    ],
  }
}

const KPAE_CTX: AirportContext = { lat: PAE.lat, lon: PAE.lon, elevationFt: 600 }

// A point mid-arc plus the local tangent (direction of travel along the arc).
function arcMidpointAndTrack(): { lat: number; lon: number; track: number } {
  const arc = dmeArc(PAE.lat, PAE.lon, ECEPO.lat, ECEPO.lon, YAVUR.lat, YAVUR.lon, true)
  const i = Math.floor(arc.length / 2)
  const track = turf.bearing(turf.point(arc[i]), turf.point(arc[i + 1]))
  return { lat: arc[i][1], lon: arc[i][0], track }
}

describe('evaluateMatch — DME arc feeders', () => {
  it('buildArcMatchPaths samples the arc transition (many points on the ~9 nm radius), not the straight final', () => {
    const paths = buildArcMatchPaths(vorAProc())
    expect(paths.length).toBe(1)
    expect(paths[0].coords.length).toBeGreaterThan(6)
    const center: [number, number] = [PAE.lon, PAE.lat]
    for (const p of paths[0].coords) {
      const d = turf.distance(turf.point(center), turf.point(p), { units: 'nauticalmiles' })
      expect(d).toBeGreaterThan(8.5)
      expect(d).toBeLessThan(9.5)
    }
    expect(buildArcMatchPaths(vorAProc({ withArc: false }))).toEqual([])
  })

  it('matches an aircraft established on the arc (flying the arc tangent)', () => {
    const { lat, lon, track } = arcMidpointAndTrack()
    const ev = evaluateMatch(aircraft({ interpLat: lat, interpLon: lon, track, altBaro: 3200 }), vorAProc(), KPAE_CTX, CAND)
    expect(ev).not.toBeNull()
    expect(ev!.crossTrackNm).toBeLessThan(0.1)
    expect(ev!.altOk).toBe(true) // 3200 vs the arc's ≥3000 crossing
    expect(ev!.preMap).toBe(true)
  })

  it('does NOT match the same on-arc aircraft when the arc leg carries no arc geometry (falls back to the straight chord)', () => {
    const { lat, lon, track } = arcMidpointAndTrack()
    const ac = aircraft({ interpLat: lat, interpLon: lon, track, altBaro: 3200 })
    expect(evaluateMatch(ac, vorAProc({ withArc: false }), KPAE_CTX, CAND)).toBeNull()
  })

  it('rejects an aircraft flying the arc the wrong way (reciprocal tangent)', () => {
    const { lat, lon, track } = arcMidpointAndTrack()
    const ac = aircraft({ interpLat: lat, interpLon: lon, track: (track + 180) % 360, altBaro: 3200 })
    expect(evaluateMatch(ac, vorAProc(), KPAE_CTX, CAND)).toBeNull()
  })

  it('still matches the straight final (representative) once past the arc', () => {
    // Between YAVUR and ZELIG on the final centerline, southbound.
    const ev = evaluateMatch(
      aircraft({ interpLat: 48.02, interpLon: -122.2778, track: 180, altBaro: 2500 }),
      vorAProc(),
      KPAE_CTX,
      CAND,
    )
    expect(ev).not.toBeNull()
    expect(ev!.crossTrackNm).toBeLessThan(0.1)
  })
})

// ── Hold (HILPT) detection ──────────────────────────────────────────────────
// A holding aircraft flies the racetrack, not the straight representative path,
// so without matching the racetrack it only registers on the inbound leg.
import { holdTrack } from '../procedureShapes'

const HOLD_FIX = { lat: 47.5, lon: -122.3 }
const HOLD_INBOUND_TRUE = 360 // holding inbound due north, right turns → outbound leg lies east

function holdProc(withHold: boolean): Procedure {
  const track = holdTrack(HOLD_FIX.lat, HOLD_FIX.lon, HOLD_INBOUND_TRUE, true, 4)
  // Representative final: straight south from the hold fix (so the racetrack's
  // outbound leg, offset east, is well off the representative).
  const wpt = (id: string, lat: number) => ({
    id, lat, lon: HOLD_FIX.lon, navaidType: 'FIX' as const, altConstraint: null, sequenceNumber: 10,
  })
  return {
    id: 'KSEA-APPROACH-HOLD', icao: 'KSEA', name: 'R16C', type: 'APPROACH', runways: ['16C'],
    waypoints: [wpt('HOLDF', HOLD_FIX.lat), wpt('RWY', HOLD_FIX.lat - 0.1)],
    symbols: [],
    geojson: {
      type: 'FeatureCollection',
      features: withHold
        ? [{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: track },
            properties: { kind: 'hold', segment: 'transition', fixId: 'HOLDF', alt: { type: 'AT_OR_ABOVE', low: 2000 } },
          }]
        : [],
    },
    hasGeometry: true, color: '#34d399',
  }
}

// The easternmost racetrack vertex sits on the outbound leg (offset east of the
// inbound/final line); its tangent is the direction of travel there.
function holdOutboundPoint(): { lat: number; lon: number; track: number } {
  const track = holdTrack(HOLD_FIX.lat, HOLD_FIX.lon, HOLD_INBOUND_TRUE, true, 4)
  let idx = 0
  track.forEach((p, i) => { if (p[0] > track[idx][0]) idx = i })
  const nxt = track[(idx + 1) % track.length]
  return { lat: track[idx][1], lon: track[idx][0], track: turf.bearing(turf.point(track[idx]), turf.point(nxt)) }
}

describe('evaluateMatch — holds (HILPT racetrack)', () => {
  it('matches an aircraft on the hold outbound leg (off the straight representative)', () => {
    const { lat, lon, track } = holdOutboundPoint()
    // Sanity: this point does NOT match without the racetrack geometry.
    expect(evaluateMatch(aircraft({ interpLat: lat, interpLon: lon, track, altBaro: 2200 }), holdProc(false), CTX, CAND)).toBeNull()
    // ...but does once the hold racetrack is present.
    const ev = evaluateMatch(aircraft({ interpLat: lat, interpLon: lon, track, altBaro: 2200 }), holdProc(true), CTX, CAND)
    expect(ev).not.toBeNull()
    expect(ev!.preMap).toBe(true) // a pre-MAP course reversal
    expect(ev!.altOk).toBe(true) // 2200 vs the hold's ≥2000
  })

  it('rejects an aircraft flying the racetrack the wrong way (reciprocal tangent)', () => {
    const { lat, lon, track } = holdOutboundPoint()
    const ac = aircraft({ interpLat: lat, interpLon: lon, track: (track + 180) % 360, altBaro: 2200 })
    expect(evaluateMatch(ac, holdProc(true), CTX, CAND)).toBeNull()
  })

  it('does not match an aircraft nowhere near the hold', () => {
    const ac = aircraft({ interpLat: 47.5, interpLon: -122.0, track: 360, altBaro: 2200 }) // ~12 nm east
    expect(evaluateMatch(ac, holdProc(true), CTX, CAND)).toBeNull()
  })
})
