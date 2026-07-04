import { describe, it, expect } from 'vitest'
import * as turf from '@turf/turf'
import {
  pickProfileTransition,
  buildProfileModel,
  glideslopeAltAt,
  alongTrackNm,
} from '../profileMath'
import type { Procedure, ProcedureLeg, ProcedureTransition } from '../../types/procedure'
import type { CifpRunwayInfo } from '../../types/cifp'

const NM = { units: 'nauticalmiles' as const }

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

// A synthetic ILS approach transition, roughly 5nm leg spacing along a
// north-south line (constant longitude):
//   IAF (DME arc, pathTerm AF) -> mid fix -> FAF (split across 2 co-located
//   legs, only the second carries the AT_OR_ABOVE constraint) -> MAP ->
//   missed fix 1 -> missed hold fix (HM)
const IAF = { lat: 47.4166, lon: -122.0 }
const MID = { lat: 47.3333, lon: -122.0 }
const FAF = { lat: 47.25, lon: -122.0 }
const MAP = { lat: 47.1666, lon: -122.0 }
const MISSED1 = { lat: 47.0833, lon: -122.0 }
const MISSED2 = { lat: 47.0, lon: -122.0 }

const legs: ProcedureLeg[] = [
  leg({ seq: 10, fixId: 'IAF1', ...IAF, role: 'iaf', pathTerm: 'AF', dmeNm: 8.5, recNavId: 'VOR1' }),
  leg({ seq: 20, fixId: 'MIDFX', ...MID, role: 'normal', pathTerm: 'CF' }),
  leg({ seq: 30, fixId: 'FAFFX', ...FAF, role: 'faf', pathTerm: 'CF', altConstraint: null }),
  leg({ seq: 31, fixId: 'FAFFX', ...FAF, role: 'faf', pathTerm: 'CF', altConstraint: { type: 'AT_OR_ABOVE', low: 1800 } }),
  leg({ seq: 40, fixId: 'MAPFX', ...MAP, role: 'map', pathTerm: 'TF' }),
  leg({ seq: 50, fixId: 'MISS1', ...MISSED1, role: 'normal', pathTerm: 'CF' }),
  leg({ seq: 60, fixId: 'MISS2', ...MISSED2, role: 'hold', pathTerm: 'HM' }),
]

const transition: ProcedureTransition = { id: '(common)', legs }

function makeProcedure(overrides: Partial<Procedure> = {}): Procedure {
  return {
    id: 'KSEA-APPROACH-I16C',
    icao: 'KSEA',
    name: 'I16C',
    type: 'APPROACH',
    runways: ['16C'],
    waypoints: [],
    symbols: [],
    geojson: { type: 'FeatureCollection', features: [] },
    hasGeometry: true,
    color: '#34d399',
    transitions: [transition],
    ...overrides,
  }
}

const rwy: CifpRunwayInfo = { id: 'RW16C', lat: 47.1, lon: -122.0, thresholdElevFt: 433, lengthFt: 11901 }

describe('pickProfileTransition', () => {
  it('returns null when transitions are absent/empty', () => {
    expect(pickProfileTransition(makeProcedure({ transitions: undefined }))).toBeNull()
    expect(pickProfileTransition(makeProcedure({ transitions: [] }))).toBeNull()
  })

  it('picks the single transition when there is only one', () => {
    const p = makeProcedure()
    expect(pickProfileTransition(p)).toBe(transition)
  })

  it('prefers the transition containing both a faf and a map leg, tiebreak most legs', () => {
    const shortNoFafMap: ProcedureTransition = {
      id: 'ENROUTE1',
      legs: [leg({ seq: 1, fixId: 'A', lat: 48, lon: -122, role: 'normal' })],
    }
    const longButNoMap: ProcedureTransition = {
      id: 'ENROUTE2',
      legs: [
        leg({ seq: 1, fixId: 'B', lat: 48, lon: -122, role: 'iaf' }),
        leg({ seq: 2, fixId: 'C', lat: 48.1, lon: -122, role: 'faf' }),
        leg({ seq: 3, fixId: 'D', lat: 48.2, lon: -122, role: 'normal' }),
        leg({ seq: 4, fixId: 'E', lat: 48.3, lon: -122, role: 'normal' }),
        leg({ seq: 5, fixId: 'F', lat: 48.4, lon: -122, role: 'normal' }),
        leg({ seq: 6, fixId: 'G', lat: 48.5, lon: -122, role: 'normal' }),
        leg({ seq: 7, fixId: 'H', lat: 48.6, lon: -122, role: 'normal' }),
        leg({ seq: 8, fixId: 'I', lat: 48.7, lon: -122, role: 'normal' }),
        leg({ seq: 9, fixId: 'J', lat: 48.8, lon: -122, role: 'normal' }),
      ],
    }
    const shortFafMap: ProcedureTransition = {
      id: 'RNAV-SHORT',
      legs: [
        leg({ seq: 1, fixId: 'K', lat: 49, lon: -122, role: 'faf' }),
        leg({ seq: 2, fixId: 'L', lat: 49.1, lon: -122, role: 'map' }),
      ],
    }
    const p = makeProcedure({ transitions: [shortNoFafMap, longButNoMap, shortFafMap, transition] })
    // `longButNoMap` has more legs (9) than `transition` (7) but lacks a map
    // leg, so it's excluded from the qualifying pool. Between the two
    // qualifying transitions (shortFafMap: 2 legs, transition: 7 legs),
    // `transition` wins on the "most legs" tiebreak.
    expect(pickProfileTransition(p)).toBe(transition)
  })

  it('falls back to the transition with the most legs when none have both roles', () => {
    const a: ProcedureTransition = { id: 'A', legs: [leg({ seq: 1, fixId: 'X', lat: 48, lon: -122 })] }
    const b: ProcedureTransition = {
      id: 'B',
      legs: [
        leg({ seq: 1, fixId: 'Y', lat: 48, lon: -122 }),
        leg({ seq: 2, fixId: 'Z', lat: 48.1, lon: -122 }),
      ],
    }
    const p = makeProcedure({ transitions: [a, b] })
    expect(pickProfileTransition(p)).toBe(b)
  })
})

describe('buildProfileModel', () => {
  const p = makeProcedure()
  const model = buildProfileModel(p, transition, rwy)

  it('merges duplicate-position legs into one fix, keeping the strongest data', () => {
    // IAF, MID, FAF(merged), MAP => 4 fixes through the MAP
    expect(model.fixes.length).toBe(4)
    const faf = model.fixes[2]
    expect(faf.fixId).toBe('FAFFX')
    expect(faf.constraint).toEqual({ type: 'AT_OR_ABOVE', low: 1800 })
    expect(faf.plotAltFt).toBe(1800)
  })

  it('splits fixes (through MAP inclusive) from missed', () => {
    expect(model.fixes[model.fixes.length - 1].role).toBe('map')
    expect(model.missed.length).toBe(2)
    expect(model.missed[0].fixId).toBe('MISS1')
    expect(model.missed[1].fixId).toBe('MISS2')
  })

  it('computes cumulative distance matching summed turf.distance calls', () => {
    const d1 = turf.distance(turf.point([IAF.lon, IAF.lat]), turf.point([MID.lon, MID.lat]), NM)
    const d2 = turf.distance(turf.point([MID.lon, MID.lat]), turf.point([FAF.lon, FAF.lat]), NM)
    const d3 = turf.distance(turf.point([FAF.lon, FAF.lat]), turf.point([MAP.lon, MAP.lat]), NM)
    const d4 = turf.distance(turf.point([MAP.lon, MAP.lat]), turf.point([MISSED1.lon, MISSED1.lat]), NM)
    const d5 = turf.distance(turf.point([MISSED1.lon, MISSED1.lat]), turf.point([MISSED2.lon, MISSED2.lat]), NM)

    expect(model.fixes[0].distNm).toBeCloseTo(0, 6)
    expect(model.fixes[1].distNm).toBeCloseTo(d1, 6)
    expect(model.fixes[2].distNm).toBeCloseTo(d1 + d2, 6)
    expect(model.fixes[3].distNm).toBeCloseTo(d1 + d2 + d3, 6)
    expect(model.missed[0].distNm).toBeCloseTo(d1 + d2 + d3 + d4, 6)
    expect(model.missed[1].distNm).toBeCloseTo(d1 + d2 + d3 + d4 + d5, 6)
    expect(model.totalNm).toBeCloseTo(d1 + d2 + d3 + d4 + d5, 6)
  })

  it('flags the DME arc IAF leg', () => {
    expect(model.fixes[0].isDmeArc).toBe(true)
    expect(model.fixes[0].dmeNm).toBe(8.5)
    expect(model.fixes[1].isDmeArc).toBe(false)
  })

  it('flags the GS-intercept FAF for a precision (ILS) approach', () => {
    expect(model.fixes[2].isGsIntercept).toBe(true)
  })

  it('does not flag GS intercept for a non-precision approach', () => {
    const rnav = makeProcedure({ name: 'RNAV RWY 16C', gpaDeg: null })
    const m2 = buildProfileModel(rnav, transition, rwy)
    expect(m2.fixes[2].isGsIntercept).toBe(false)
  })

  it('extracts the hold on the last missed leg with inMissed=true', () => {
    expect(model.holds).toHaveLength(1)
    expect(model.holds[0]).toEqual({ atFixIdx: 1, inMissed: true, kind: 'HM' })
  })

  it('uses the fallback 3.0deg GS and flags it when gpaDeg is absent', () => {
    expect(model.usedFallbackGs).toBe(true)
    expect(model.gsAngleDeg).toBe(3.0)
  })

  it('uses the published GS angle and clears the fallback flag when gpaDeg is present', () => {
    const precise = makeProcedure({ gpaDeg: 3.2, tchFt: 55 })
    const m2 = buildProfileModel(precise, transition, rwy)
    expect(m2.usedFallbackGs).toBe(false)
    expect(m2.gsAngleDeg).toBe(3.2)
    expect(m2.tchFt).toBe(55)
  })

  it('pulls tdze/runway length from the CifpRunwayInfo, and nulls them out without one', () => {
    expect(model.tdzeFt).toBe(433)
    expect(model.runwayLengthFt).toBe(11901)
    const noRwy = buildProfileModel(p, transition, null)
    expect(noRwy.tdzeFt).toBeNull()
    expect(noRwy.runwayLengthFt).toBeNull()
  })
})

describe('glideslopeAltAt', () => {
  const p = makeProcedure({ gpaDeg: 3.0, tchFt: 55 })
  const model = buildProfileModel(p, transition, rwy)

  it('equals tdze + tch at the threshold (0nm)', () => {
    expect(glideslopeAltAt(model, 0)).toBeCloseTo(433 + 55, 6)
  })

  it('adds distance * tan(gs) * 6076.12 ft/nm at 5nm out', () => {
    const expected = 433 + 55 + 5 * Math.tan((3.0 * Math.PI) / 180) * 6076.12
    expect(glideslopeAltAt(model, 5)).toBeCloseTo(expected, 6)
  })

  it('falls back to tdze=0 / tch=50 when both are unknown', () => {
    const bare = buildProfileModel(makeProcedure({ gpaDeg: 3.0 }), transition, null)
    expect(glideslopeAltAt(bare, 0)).toBeCloseTo(50, 6)
  })
})

describe('alongTrackNm', () => {
  it('returns ~0 cross-track and the expected along-track distance for a point on the line', () => {
    const d1 = turf.distance(turf.point([IAF.lon, IAF.lat]), turf.point([MID.lon, MID.lat]), NM)
    const { distNm, xtNm } = alongTrackNm(transition, MID.lat, MID.lon)
    expect(xtNm).toBeCloseTo(0, 3)
    expect(distNm).toBeCloseTo(d1, 2)
  })

  it('reports cross-track offset for a point abeam a segment', () => {
    const mid = turf.midpoint(turf.point([IAF.lon, IAF.lat]), turf.point([MID.lon, MID.lat]))
    const offset = turf.destination(mid, 1, 90, NM) // 1nm due east of the track
    const [lon, lat] = offset.geometry.coordinates
    const { distNm, xtNm } = alongTrackNm(transition, lat, lon)
    expect(xtNm).toBeCloseTo(1, 1)
    const halfway = turf.distance(turf.point([IAF.lon, IAF.lat]), turf.point([MID.lon, MID.lat]), NM) / 2
    expect(distNm).toBeCloseTo(halfway, 1)
  })
})
