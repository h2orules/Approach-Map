import { describe, it, expect } from 'vitest'
import * as turf from '@turf/turf'
import {
  pickProfileTransition,
  buildProfileModel,
  glideslopeAltAt,
  alongTrackNm,
  descentProfilePoints,
  fixRenderAltitudes,
  segmentDistancesNm,
  labelStaggerOffsets,
  placeProfileLabels,
} from '../profileMath'
import type { ProfileFix, ProfileModel } from '../profileMath'
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

  it('carries the DME source navaid ident through from the leg recNavId', () => {
    expect(model.fixes[0].dmeNavaidId).toBe('VOR1')
    // Fixes with no dmeNm never got a recNavId set, either.
    expect(model.fixes[1].dmeNavaidId).toBeNull()
  })

  it('nulls dmeNavaidId when the DME-carrying leg has an empty recNavId', () => {
    const noIdentLegs: ProcedureLeg[] = [
      leg({ seq: 10, fixId: 'IAF1', ...IAF, role: 'iaf', pathTerm: 'AF', dmeNm: 8.5, recNavId: '' }),
      leg({ seq: 20, fixId: 'MIDFX', ...MID, role: 'normal', pathTerm: 'CF' }),
      leg({ seq: 30, fixId: 'FAFFX', ...FAF, role: 'faf', pathTerm: 'CF', altConstraint: { type: 'AT_OR_ABOVE', low: 1800 } }),
      leg({ seq: 40, fixId: 'MAPFX', ...MAP, role: 'map', pathTerm: 'TF' }),
    ]
    const t2: ProcedureTransition = { id: 'no-ident', legs: noIdentLegs }
    const m2 = buildProfileModel(makeProcedure({ transitions: [t2] }), t2, rwy)
    expect(m2.fixes[0].dmeNm).toBe(8.5)
    expect(m2.fixes[0].dmeNavaidId).toBeNull()
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

describe('fixRenderAltitudes', () => {
  function pf(fixId: string, distNm: number, plotAltFt: number | null, role: ProfileFix['role'] = 'normal'): ProfileFix {
    return {
      fixId, distNm, plotAltFt, role,
      constraint: plotAltFt == null ? null : { type: 'AT', low: plotAltFt },
      pathTerm: 'TF', speedKt: 0, isGsIntercept: role === 'faf', isDmeArc: false,
      dmeNm: null, dmeNavaidId: null, flyover: false,
    }
  }
  const base: Omit<ProfileModel, 'fixes'> = {
    procedureId: 'x', name: 'x', gsAngleDeg: 3, usedFallbackGs: false, tchFt: 50,
    tdzeFt: 400, runwayLengthFt: null, totalNm: 13, holds: [], missed: [],
  }

  it('interpolates an unconstrained interior fix between its constrained neighbours', () => {
    // A(5000) B(3000) C(none) FAF(1800) RW(none) — C sits 3/5 of the way from B to FAF.
    const m: ProfileModel = {
      ...base,
      fixes: [pf('A', 0, 5000), pf('B', 5, 3000), pf('C', 8, null), pf('FAF', 10, 1800, 'faf'), pf('RW', 13, null, 'map')],
    }
    const alts = fixRenderAltitudes(m)
    expect(alts[0]).toBe(5000)
    expect(alts[1]).toBe(3000)
    expect(alts[2]).toBeCloseTo(2280, 6) // 3000 + (1800-3000) * (8-5)/(10-5)
    expect(alts[3]).toBe(1800)
    expect(alts[4]).toBeCloseTo(glideslopeAltAt(m, 0), 6) // runway anchored to threshold crossing
    // The interpolated fix must sit strictly between its neighbours, never at TDZE.
    expect(alts[2]).toBeGreaterThan(m.tdzeFt!)
  })

  it('anchors leading unconstrained fixes to the first constrained altitude (flat, not TDZE)', () => {
    const m: ProfileModel = {
      ...base,
      fixes: [pf('A', 0, null), pf('B', 5, null), pf('FAF', 10, 2000, 'faf'), pf('RW', 13, null, 'map')],
    }
    const alts = fixRenderAltitudes(m)
    expect(alts[0]).toBe(2000)
    expect(alts[1]).toBe(2000)
  })
})

describe('descentProfilePoints', () => {
  const p = makeProcedure({ gpaDeg: 3.0, tchFt: 55 })
  const model = buildProfileModel(p, transition, rwy)

  it('connects IAF/MID/FAF directly (no step-downs) then rides the glideslope to the threshold', () => {
    const pts = descentProfilePoints(model)
    // IAF, MID, FAF (the gs-intercept anchor since this is a precision approach), then threshold.
    expect(pts).toHaveLength(4)
    // IAF and MID carry no constraint here; sitting before the only constrained
    // fix (FAF, 1800) they anchor to it rather than dropping to the runway.
    expect(pts[0]).toEqual({ distNm: model.fixes[0].distNm, altFt: 1800 })
    expect(pts[1]).toEqual({ distNm: model.fixes[1].distNm, altFt: 1800 })
    expect(pts[2]).toEqual({ distNm: model.fixes[2].distNm, altFt: model.fixes[2].plotAltFt })
    // MAP fix's own plotted altitude is skipped; the final vertex instead sits
    // at the threshold distance and the computed glideslope altitude.
    const thresholdDistNm = model.fixes[model.fixes.length - 1].distNm
    expect(pts[3]).toEqual({ distNm: thresholdDistNm, altFt: glideslopeAltAt(model, 0) })
  })

  it('falls back to a direct point-to-point polyline when no fix is a FAF or gs-intercept', () => {
    const noFafLegs: ProcedureLeg[] = [
      leg({ seq: 10, fixId: 'A', ...IAF, role: 'normal', altConstraint: { type: 'AT', low: 5000 } }),
      leg({ seq: 20, fixId: 'B', ...MID, role: 'normal', altConstraint: { type: 'AT', low: 3000 } }),
    ]
    const t2: ProcedureTransition = { id: 'no-faf', legs: noFafLegs }
    const m2 = buildProfileModel(makeProcedure({ transitions: [t2] }), t2, rwy)
    expect(descentProfilePoints(m2)).toEqual([
      { distNm: m2.fixes[0].distNm, altFt: 5000 },
      { distNm: m2.fixes[1].distNm, altFt: 3000 },
    ])
  })

  it('returns an empty array when the model has no approach fixes', () => {
    expect(descentProfilePoints({ ...model, fixes: [] })).toEqual([])
  })
})

describe('segmentDistancesNm', () => {
  it('returns consecutive deltas, one shorter than the input', () => {
    const fixes = [{ distNm: 0 }, { distNm: 3.1 }, { distNm: 7.4 }, { distNm: 7.4 }]
    expect(segmentDistancesNm(fixes)).toEqual([3.1, 4.300000000000001, 0])
  })

  it('returns an empty array for 0 or 1 fixes', () => {
    expect(segmentDistancesNm([])).toEqual([])
    expect(segmentDistancesNm([{ distNm: 5 }])).toEqual([])
  })
})

describe('labelStaggerOffsets', () => {
  it('maps the highest altitude to 0 and the lowest to maxOffsetPx', () => {
    const offsets = labelStaggerOffsets([5000, 3000, 1000], 40)
    expect(offsets[0]).toBeCloseTo(0, 6)
    expect(offsets[2]).toBeCloseTo(40, 6)
    expect(offsets[1]).toBeCloseTo(20, 6)
  })

  it('repeats the previous offset for a null (unconstrained) altitude', () => {
    const offsets = labelStaggerOffsets([5000, null, 1000], 40)
    expect(offsets[1]).toBeCloseTo(offsets[0], 6)
  })

  it('returns all zeros when every altitude is null', () => {
    expect(labelStaggerOffsets([null, null], 40)).toEqual([0, 0])
  })

  it('is stable (all zero offset) when every fix shares the same altitude', () => {
    expect(labelStaggerOffsets([2000, 2000], 40)).toEqual([0, 0])
  })
})

describe('placeProfileLabels', () => {
  it('places every label above when entries are spread out', () => {
    const entries = [{ distNm: 0 }, { distNm: 10 }, { distNm: 20 }]
    expect(placeProfileLabels(entries, 0.01)).toEqual(['above', 'above', 'above'])
  })

  it('alternates label placement for two closely-spaced entries', () => {
    const entries = [{ distNm: 0 }, { distNm: 0.05 }]
    expect(placeProfileLabels(entries, 0.01)).toEqual(['above', 'below'])
  })

  it('resets to above once spacing widens again, independent of input order', () => {
    // Sorted by distNm: idx1 (0) -> idx2 (0.05, close -> flips) -> idx0 (5, far -> resets to above).
    const entries = [{ distNm: 5 }, { distNm: 0 }, { distNm: 0.05 }]
    expect(placeProfileLabels(entries, 0.01)).toEqual(['above', 'above', 'below'])
  })
})
