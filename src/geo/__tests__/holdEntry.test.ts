import { describe, it, expect } from 'vitest'
import * as turf from '@turf/turf'
import {
  collectHoldSpecs,
  classifyHoldEntry,
  holdEntryPath,
  reduceHoldEntries,
  emptyHoldEntryState,
  type HoldEntryInput,
  type HoldEntryState,
} from '../holdEntry'
import { dest, holdTrack } from '../procedureShapes'
import type { Procedure, AltConstraint } from '../../types/procedure'
import type { InterpolatedAircraft } from '../../types/aircraft'
import type { HoldSpec, PredictedPath } from '../../types/path'
import type { Feature } from 'geojson'

const NM = { units: 'nauticalmiles' as const }
type Pt = [number, number]

const FIX_LAT = 47.5
const FIX_LON = -122.3
const FIX: Pt = [FIX_LON, FIX_LAT]
const HEX = 'a1b2c3'

const distNm = (a: Pt, b: Pt): number => turf.distance(turf.point(a), turf.point(b), NM)
const brg = (a: Pt, b: Pt): number => (turf.bearing(turf.point(a), turf.point(b)) + 360) % 360
const brgDelta = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180)

// ── Factories ───────────────────────────────────────────────────────────────

function makeSpec(over: Partial<HoldSpec> = {}): HoldSpec {
  return {
    key: 'KXYZ-R34|SAVOY',
    procId: 'KXYZ-R34',
    fixId: 'SAVOY',
    fixLat: FIX_LAT,
    fixLon: FIX_LON,
    inboundCourseTrue: 360,
    turnRight: true,
    legNm: 4,
    alt: null,
    segment: 'transition',
    ...over,
  }
}

function makeAc(over: Partial<InterpolatedAircraft> = {}): InterpolatedAircraft {
  const pos = dest(FIX, 5, 210) // 5 nm out on the 210 radial → bearing to fix 030
  return {
    hex: HEX,
    flight: 'TEST1',
    registration: 'N1',
    typeCode: 'C172',
    lat: pos[1],
    lon: pos[0],
    altBaro: 4000,
    altGeom: 4000,
    groundspeed: 150,
    track: 30,
    baroRate: 0,
    squawk: '2345',
    lastPollMs: 0,
    interpLat: pos[1],
    interpLon: pos[0],
    ...over,
  }
}

/** Predicted path arriving at the fix along the given radial. */
function makePred(altFt = 4000, radialDeg = 210): PredictedPath {
  const p1 = dest(FIX, 2, radialDeg)
  return {
    hex: HEX,
    mode: 'straight',
    points: [
      { lon: p1[0], lat: p1[1], tSec: 60, altFt },
      { lon: FIX[0], lat: FIX[1], tSec: 120, altFt },
    ],
  }
}

function makeInput(over: Partial<HoldEntryInput> = {}): HoldEntryInput {
  return {
    nowMs: 1000,
    aircraft: [makeAc()],
    predictions: new Map([[HEX, makePred()]]),
    specs: [makeSpec()],
    assignments: {},
    ...over,
  }
}

function holdFeature(over: Record<string, unknown> = {}, coords?: Pt[]): Feature {
  return {
    type: 'Feature',
    properties: {
      kind: 'hold',
      segment: 'transition',
      transitionId: 'SAVOY',
      fixId: 'SAVOY',
      inboundCourseMag: 345,
      turnRight: true,
      alt: { type: 'AT_OR_ABOVE', low: 2000 } satisfies AltConstraint,
      ...over,
    },
    geometry: { type: 'LineString', coordinates: coords ?? holdTrack(FIX_LAT, FIX_LON, 360, true, 4) },
  }
}

function makeProc(over: Partial<Procedure> = {}): Procedure {
  return {
    id: 'KXYZ-R34',
    icao: 'KXYZ',
    name: 'R34',
    type: 'APPROACH',
    runways: ['34'],
    waypoints: [
      { id: 'SAVOY', lat: FIX_LAT, lon: FIX_LON, navaidType: 'FIX', altConstraint: null, sequenceNumber: 10 },
    ],
    symbols: [],
    geojson: { type: 'FeatureCollection', features: [holdFeature()] },
    hasGeometry: true,
    color: '#22d3ee',
    magVarDeg: 15,
    ...over,
  }
}

// ── classifyHoldEntry ───────────────────────────────────────────────────────

describe('classifyHoldEntry', () => {
  const cases: Array<[number, 'direct' | 'teardrop' | 'parallel']> = [
    [0, 'direct'],
    [69.9, 'direct'],
    [70, 'direct'], // boundary: exactly 70 stays direct
    [70.1, 'parallel'],
    [120, 'parallel'],
    [180, 'parallel'], // boundary: exactly 180 is parallel
    [180.1, 'teardrop'],
    [249.9, 'teardrop'],
    [250, 'teardrop'], // boundary: exactly 250 is teardrop
    [250.1, 'direct'],
    [300, 'direct'],
  ]

  it.each(cases)('right-turn hold, r=%s → %s', (r, expected) => {
    // hold inbound 360; aircraft track = inbound + r
    expect(classifyHoldEntry((360 + r) % 360, 360, true)).toBe(expected)
  })

  it('left-turn hold mirrors the sectors', () => {
    // r_left = 360 − r_right: left r=290 behaves like right r=70 (direct)
    expect(classifyHoldEntry(290, 360, false)).toBe('direct')
    expect(classifyHoldEntry(289.9, 360, false)).toBe('parallel') // like right 70.1
    expect(classifyHoldEntry(180, 360, false)).toBe('parallel') // like right 180
    expect(classifyHoldEntry(110, 360, false)).toBe('teardrop') // like right 250
    expect(classifyHoldEntry(109.9, 360, false)).toBe('direct') // like right 250.1
    expect(classifyHoldEntry(0, 360, false)).toBe('direct')
  })
})

// ── collectHoldSpecs ────────────────────────────────────────────────────────

describe('collectHoldSpecs', () => {
  it('dedupes holdInLieu vs hold feature at the same fix, the DRAWN feature winning', () => {
    // holdInLieu disagrees with the drawn racetrack on turn direction (a
    // HILPT/missed data mismatch). The drawn feature is what the user sees, so
    // its values must win — otherwise the entry mirrors to the wrong side.
    const proc = makeProc({
      holdInLieu: {
        fixId: 'SAVOY',
        transitionId: 'SAVOY',
        inboundCourseMag: 345,
        outboundCourseMag: 165,
        turnRight: false, // ← opposite of the drawn feature (turnRight: true)
        legNm: 5,
        alt: { type: 'AT_OR_ABOVE', low: 2000 },
      },
    })
    const specs = collectHoldSpecs([proc])
    expect(specs).toHaveLength(1)
    expect(specs[0].turnRight).toBe(true) // from the drawn feature, not holdInLieu
    expect(specs[0].legNm).toBeCloseTo(4, 2) // measured off the drawn racetrack
    expect(specs[0].key).toBe('KXYZ-R34|SAVOY')
    expect(specs[0].segment).toBe('transition')
  })

  it('prefers a transition hold over a missed hold at the same fix', () => {
    const proc = makeProc({
      geojson: {
        type: 'FeatureCollection',
        features: [
          holdFeature({ segment: 'missed', turnRight: false }),
          holdFeature({ segment: 'transition', turnRight: true }),
        ],
      },
    })
    const specs = collectHoldSpecs([proc])
    expect(specs).toHaveLength(1)
    expect(specs[0].segment).toBe('transition')
    expect(specs[0].turnRight).toBe(true)
  })

  it('anchors the spec at the drawn racetrack fix, not a stray waypoint position', () => {
    // Named waypoint deliberately far from where the racetrack is drawn: the
    // spec (and thus the entry loop) must follow the drawn geometry, or the
    // loop floats "in space" away from the visible hold.
    const proc = makeProc({
      waypoints: [
        { id: 'SAVOY', lat: FIX_LAT + 3, lon: FIX_LON + 3, navaidType: 'FIX', altConstraint: null, sequenceNumber: 10 },
      ],
    })
    const specs = collectHoldSpecs([proc])
    expect(specs).toHaveLength(1)
    expect(specs[0].fixLat).toBeCloseTo(FIX_LAT, 4)
    expect(specs[0].fixLon).toBeCloseTo(FIX_LON, 4)
    expect(distNm(holdEntryPath(specs[0], 'direct')[0], FIX)).toBeLessThan(0.01)
  })

  it('applies magvar: inboundCourseTrue = mag + var(E)', () => {
    const specs = collectHoldSpecs([makeProc()])
    expect(specs).toHaveLength(1)
    expect(specs[0].inboundCourseTrue).toBeCloseTo(360 % 360, 5) // 345 + 15
    expect(specs[0].fixLat).toBeCloseTo(FIX_LAT, 6)
    expect(specs[0].fixLon).toBeCloseTo(FIX_LON, 6)
  })

  it('defaults legNm to 4 for feature-only holds and keeps missed segment', () => {
    const proc = makeProc({
      geojson: { type: 'FeatureCollection', features: [holdFeature({ segment: 'missed' })] },
    })
    const specs = collectHoldSpecs([proc])
    expect(specs).toHaveLength(1)
    expect(specs[0].legNm).toBeCloseTo(4, 2)
    expect(specs[0].segment).toBe('missed')
    expect(specs[0].alt).toEqual({ type: 'AT_OR_ABOVE', low: 2000 })
  })

  it('caches per Procedure object (identity-stable specs)', () => {
    const proc = makeProc()
    const a = collectHoldSpecs([proc])
    const b = collectHoldSpecs([proc])
    expect(b[0]).toBe(a[0])
  })

  it('derives course and turn direction from the DRAWN geometry when props disagree (LOFAL)', () => {
    // LOFAL-style: LEFT-turn hold, drawn true inbound ≈ 145° (130M + 15E).
    // The feature's PROPS lie about both course and turn direction (drawn-
    // racetrack course/magvar parser bugs are a separate investigation) — the
    // spec must follow the drawn coordinates, which are what the user sees, so
    // the entry can never mirror or rotate relative to the on-screen hold.
    const proc = makeProc({
      geojson: {
        type: 'FeatureCollection',
        features: [
          holdFeature(
            { inboundCourseMag: 310, turnRight: true }, // both wrong vs the drawn loop
            holdTrack(FIX_LAT, FIX_LON, 145, false, 5),
          ),
        ],
      },
    })
    const specs = collectHoldSpecs([proc])
    expect(specs).toHaveLength(1)
    expect(brgDelta(specs[0].inboundCourseTrue, 145)).toBeLessThan(0.5)
    expect(specs[0].turnRight).toBe(false)
    expect(specs[0].legNm).toBeCloseTo(5, 1)
  })
})

// ── holdEntryPath ───────────────────────────────────────────────────────────

describe('holdEntryPath', () => {
  const spec = makeSpec()

  it.each(['direct', 'teardrop', 'parallel'] as const)('%s path starts at the fix', (kind) => {
    const path = holdEntryPath(spec, kind)
    expect(distNm(path[0], FIX)).toBeLessThan(0.01)
  })

  it.each(['direct', 'teardrop', 'parallel'] as const)(
    '%s last segment tracks the inbound course (±5°)',
    (kind) => {
      const path = holdEntryPath(spec, kind)
      const last = brg(path[path.length - 2], path[path.length - 1])
      expect(brgDelta(last, 360)).toBeLessThan(5)
    },
  )

  it('direct entry is the racetrack itself (mates with holdTrack, right turns)', () => {
    const path = holdEntryPath(spec, 'direct')
    const track = holdTrack(FIX_LAT, FIX_LON, 360, true, 4)
    for (const p of path) {
      const nearest = Math.min(...track.map((t) => distNm(p, t)))
      expect(nearest).toBeLessThan(0.02)
    }
  })

  it('direct entry mates with holdTrack for a left-turn hold too', () => {
    const left = makeSpec({ turnRight: false })
    const path = holdEntryPath(left, 'direct')
    const track = holdTrack(FIX_LAT, FIX_LON, 360, false, 4)
    for (const p of path) {
      const nearest = Math.min(...track.map((t) => distNm(p, t)))
      expect(nearest).toBeLessThan(0.02)
    }
  })

  it('teardrop outbound is recip − 30° for a right hold (toward the holding side)', () => {
    const path = holdEntryPath(spec, 'teardrop')
    expect(brgDelta(brg(path[0], path[1]), 150)).toBeLessThan(1)
    expect(path[1][0]).toBeGreaterThan(FIX_LON) // east = holding side of an inbound-360 right hold
  })

  it('teardrop outbound is recip + 30° for a left hold', () => {
    const left = makeSpec({ turnRight: false })
    const path = holdEntryPath(left, 'teardrop')
    expect(brgDelta(brg(path[0], path[1]), 210)).toBeLessThan(1)
    expect(path[1][0]).toBeLessThan(FIX_LON) // west = holding side for left turns
  })

  it('parallel outbound lies on the NON-holding side', () => {
    const rightPath = holdEntryPath(spec, 'parallel')
    expect(rightPath[1][0]).toBeLessThan(FIX_LON) // west of an inbound-360 right hold

    const leftPath = holdEntryPath(makeSpec({ turnRight: false }), 'parallel')
    expect(leftPath[1][0]).toBeGreaterThan(FIX_LON)
  })

  it('parallel rejoins the inbound course outside the fix', () => {
    const path = holdEntryPath(spec, 'parallel')
    const join = path[path.length - 2]
    // Join point sits behind the fix (south, on the reciprocal side) on the course line.
    expect(brgDelta(brg(FIX, join), 180)).toBeLessThan(1)
  })
})

// ── MGNUM-style geometry regressions (defects a & b) ─────────────────────────

/** Signed cross-track of `p` from the inbound-course line through the fix:
 *  positive = right of the inbound direction (the holding side for right turns). */
function sideOfCourse(p: Pt, fix: Pt, inb: number): number {
  const d = distNm(fix, p)
  const b = turf.bearing(turf.point(fix), turf.point(p))
  const theta = ((b - inb + 540) % 360) - 180
  return d * Math.sin((theta * Math.PI) / 180)
}
const centroidSide = (path: Pt[], fix: Pt, inb: number): number =>
  path.reduce((s, p) => s + sideOfCourse(p, fix, inb), 0) / path.length

/** Largest interior direction reversal (deg), ignoring near-zero-length
 *  segments (coincident vertices produce a meaningless 180° artifact). */
function maxKinkDeg(path: Pt[]): number {
  let max = 0
  for (let i = 1; i < path.length - 1; i++) {
    if (distNm(path[i], path[i + 1]) < 1e-4 || distNm(path[i - 1], path[i]) < 1e-4) continue
    const b1 = brg(path[i - 1], path[i])
    const b2 = brg(path[i], path[i + 1])
    max = Math.max(max, brgDelta(b1, b2))
  }
  return max
}

describe('holdEntryPath MGNUM-style geometry', () => {
  // MGNUM (KSEA I34L HILPT family) charts an inbound course near 161°.
  const INB = 161

  it.each([true, false])('direct & teardrop sit on the same side as holdTrack (right=%s)', (right) => {
    const spec = makeSpec({ inboundCourseTrue: INB, turnRight: right })
    const trackSide = centroidSide(holdTrack(FIX_LAT, FIX_LON, INB, right, 4), FIX, INB)
    for (const kind of ['direct', 'teardrop'] as const) {
      const entrySide = centroidSide(holdEntryPath(spec, kind), FIX, INB)
      // Same sign as the drawn racetrack — never mirrored to the far side.
      expect(Math.sign(entrySide)).toBe(Math.sign(trackSide))
    }
    // Parallel is deliberately drawn on the NON-holding side.
    const parSide = centroidSide(holdEntryPath(spec, 'parallel'), FIX, INB)
    expect(Math.sign(parSide)).toBe(-Math.sign(trackSide))
  })

  it.each([true, false])('no entry path has a spurious mid-path reversal (right=%s)', (right) => {
    for (const inb of [INB, 360, 90]) {
      const spec = makeSpec({ inboundCourseTrue: inb, turnRight: right })
      for (const kind of ['direct', 'teardrop', 'parallel'] as const) {
        // Turn arcs step ≤45°; the only intentional corner is the single 45°
        // intercept. Anything ≥100° would be a jog/reversal like the old teardrop.
        expect(maxKinkDeg(holdEntryPath(spec, kind))).toBeLessThan(100)
      }
    }
  })

  it('teardrop rolls out onto the inbound course with a single 45° intercept, no dog-leg', () => {
    const spec = makeSpec({ inboundCourseTrue: INB, turnRight: true })
    const path = holdEntryPath(spec, 'teardrop')
    // Final leg exactly on the inbound course.
    expect(brgDelta(brg(path[path.length - 2], path[path.length - 1]), INB)).toBeLessThan(1)
    // The single sharpest corner is ~45° (the intercept), not a ~135° reversal.
    expect(maxKinkDeg(path)).toBeLessThan(55)
    expect(maxKinkDeg(path)).toBeGreaterThan(35)
  })
})

// ── Direct-entry orientation invariant (LOFAL defect 1) ─────────────────────

describe('direct entry superimposes on the drawn racetrack', () => {
  // End-to-end through collectHoldSpecs with DELIBERATELY WRONG props (course
  // and turn direction both lie): the spec derives from the drawn geometry, so
  // the direct-entry loop must land on the drawn racetrack — extending from
  // the fix toward the OUTBOUND side, never mirrored or flipped.
  const cases: Array<[number, boolean]> = [
    [130, true],
    [130, false],
    [341, true],
    [341, false],
  ]

  it.each(cases)('inb=%s right=%s', (inb, right) => {
    const track = holdTrack(FIX_LAT, FIX_LON, inb, right, 4)
    const wrongMag = (inb + 180 - 15 + 360) % 360 // props claim the reciprocal
    const proc = makeProc({
      geojson: {
        type: 'FeatureCollection',
        features: [holdFeature({ inboundCourseMag: wrongMag, turnRight: !right }, track)],
      },
    })
    const specs = collectHoldSpecs([proc])
    expect(specs).toHaveLength(1)
    expect(specs[0].turnRight).toBe(right)
    expect(brgDelta(specs[0].inboundCourseTrue, inb)).toBeLessThan(0.5)

    const path = holdEntryPath(specs[0], 'direct')
    const within = path.filter((p) => Math.min(...track.map((t) => distNm(p, t))) < 0.05)
    expect(within.length / path.length).toBeGreaterThan(0.8)
  })
})

// ── Trigger gates ───────────────────────────────────────────────────────────

describe('reduceHoldEntries trigger gates', () => {
  it('creates an entry when every gate passes', () => {
    const s = reduceHoldEntries(emptyHoldEntryState(), makeInput())
    const rec = s.entries.get(HEX)
    expect(rec).toBeDefined()
    expect(rec!.specKey).toBe('KXYZ-R34|SAVOY')
    expect(rec!.entry).toBe('direct') // arriving on 030 vs inbound 360 → r=30
    expect(rec!.path.length).toBeGreaterThan(2)
    expect(rec!.divergedPolls).toBe(0)
    expect(rec!.crossedFix).toBe(false)
  })

  it('classifies from the predicted arrival track (parallel case)', () => {
    const pos = dest(FIX, 5, 300)
    const input = makeInput({
      aircraft: [makeAc({ lat: pos[1], lon: pos[0], interpLat: pos[1], interpLon: pos[0], track: 120 })],
      predictions: new Map([[HEX, makePred(4000, 300)]]),
    })
    const s = reduceHoldEntries(emptyHoldEntryState(), input)
    expect(s.entries.get(HEX)?.entry).toBe('parallel') // r = 120
  })

  it('rejects a track 11° off the bearing to the fix', () => {
    const s = reduceHoldEntries(emptyHoldEntryState(), makeInput({ aircraft: [makeAc({ track: 41 })] }))
    expect(s.entries.size).toBe(0)
  })

  it('rejects an ETA over 180 s', () => {
    // 5 nm at 90 kt → 200 s
    const s = reduceHoldEntries(
      emptyHoldEntryState(),
      makeInput({ aircraft: [makeAc({ groundspeed: 90 })] }),
    )
    expect(s.entries.size).toBe(0)
  })

  it('rejects a predicted path that never passes the fix', () => {
    const p1 = dest(FIX, 5, 120)
    const p2 = dest(FIX, 3, 120)
    const miss: PredictedPath = {
      hex: HEX,
      mode: 'straight',
      points: [
        { lon: p1[0], lat: p1[1], tSec: 60, altFt: 4000 },
        { lon: p2[0], lat: p2[1], tSec: 120, altFt: 4000 },
      ],
    }
    const s = reduceHoldEntries(emptyHoldEntryState(), makeInput({ predictions: new Map([[HEX, miss]]) }))
    expect(s.entries.size).toBe(0)
  })

  it('rejects an aircraft already established inbound', () => {
    const pos = dest(FIX, 3, 180) // on the inbound course line, south of the fix
    const input = makeInput({
      aircraft: [makeAc({ lat: pos[1], lon: pos[0], interpLat: pos[1], interpLon: pos[0], track: 360 })],
      predictions: new Map([[HEX, makePred(4000, 180)]]),
    })
    const s = reduceHoldEntries(emptyHoldEntryState(), input)
    expect(s.entries.size).toBe(0)
  })

  it('rejects a predicted altitude 2500 ft above an AT_OR_BELOW constraint', () => {
    const spec = makeSpec({ alt: { type: 'AT_OR_BELOW', low: 4000 } })
    const bad = reduceHoldEntries(
      emptyHoldEntryState(),
      makeInput({ specs: [spec], predictions: new Map([[HEX, makePred(6500)]]) }),
    )
    expect(bad.entries.size).toBe(0)

    const ok = reduceHoldEntries(
      emptyHoldEntryState(),
      makeInput({ specs: [spec], predictions: new Map([[HEX, makePred(4500)]]) }),
    )
    expect(ok.entries.size).toBe(1)
  })

  it('rejects a hex with an approach assignment', () => {
    const s = reduceHoldEntries(
      emptyHoldEntryState(),
      makeInput({ assignments: { [HEX]: 'KXYZ-I34' } }),
    )
    expect(s.entries.size).toBe(0)
  })
})

// ── Reducer lifecycle ───────────────────────────────────────────────────────

describe('reduceHoldEntries lifecycle', () => {
  function created(): HoldEntryState {
    return reduceHoldEntries(emptyHoldEntryState(), makeInput())
  }

  it('keeps path identity stable across qualifying polls', () => {
    const s1 = created()
    const pos = dest(FIX, 4.5, 210)
    const s2 = reduceHoldEntries(
      s1,
      makeInput({
        nowMs: 2000,
        aircraft: [makeAc({ lat: pos[1], lon: pos[0], interpLat: pos[1], interpLon: pos[0] })],
      }),
    )
    const r1 = s1.entries.get(HEX)!
    const r2 = s2.entries.get(HEX)!
    expect(r2.path).toBe(r1.path)
    expect(r2.entry).toBe(r1.entry)
    expect(r2.lastQualifiedMs).toBe(2000)
    expect(r2.divergedPolls).toBe(0)
  })

  it('clears when an assignment appears', () => {
    const s2 = reduceHoldEntries(created(), makeInput({ assignments: { [HEX]: 'KXYZ-I34' } }))
    expect(s2.entries.size).toBe(0)
  })

  it('clears once crossedFix and aligned with the inbound course', () => {
    const s1 = created()
    const pos = dest(FIX, 0.3, 210)
    // Within 0.5 nm of the fix (crossedFix) and track 030 is within 75° of inbound 360.
    const s2 = reduceHoldEntries(
      s1,
      makeInput({
        nowMs: 2000,
        aircraft: [makeAc({ lat: pos[1], lon: pos[0], interpLat: pos[1], interpLon: pos[0] })],
      }),
    )
    expect(s2.entries.size).toBe(0)
  })

  it('persists after crossing the fix while still turning (track > 75° off inbound)', () => {
    const s1 = created()
    const pos = dest(FIX, 0.4, 210)
    const s2 = reduceHoldEntries(
      s1,
      makeInput({
        nowMs: 2000,
        aircraft: [makeAc({ lat: pos[1], lon: pos[0], interpLat: pos[1], interpLon: pos[0], track: 120 })],
      }),
    )
    const rec = s2.entries.get(HEX)
    expect(rec).toBeDefined()
    expect(rec!.crossedFix).toBe(true)

    // Then rolling out inbound clears it.
    const s3 = reduceHoldEntries(
      s2,
      makeInput({
        nowMs: 3000,
        aircraft: [makeAc({ lat: pos[1], lon: pos[0], interpLat: pos[1], interpLon: pos[0], track: 350 })],
      }),
    )
    expect(s3.entries.size).toBe(0)
  })

  function divergingInput(nowMs: number, distOut: number): HoldEntryInput {
    const pos = dest(FIX, distOut, 210)
    return makeInput({
      nowMs,
      aircraft: [makeAc({ lat: pos[1], lon: pos[0], interpLat: pos[1], interpLon: pos[0], track: 210 })],
    })
  }

  it('clears after 3 consecutive diverging polls', () => {
    let s = created()
    s = reduceHoldEntries(s, divergingInput(2000, 6))
    expect(s.entries.get(HEX)?.divergedPolls).toBe(1)
    s = reduceHoldEntries(s, divergingInput(3000, 7))
    expect(s.entries.get(HEX)?.divergedPolls).toBe(2)
    s = reduceHoldEntries(s, divergingInput(4000, 8))
    expect(s.entries.size).toBe(0)
  })

  it('clears a stalled entry after HOLD_ENTRY_STALE_MS even without divergence', () => {
    // Aircraft loiters off the fix: non-qualifying (track points away) but at a
    // constant distance, so divergedPolls never increments — the old code would
    // strand the loop forever. The stale-out must clear it regardless.
    const stalled = (nowMs: number): HoldEntryInput => {
      const pos = dest(FIX, 5, 210)
      return makeInput({
        nowMs,
        aircraft: [makeAc({ lat: pos[1], lon: pos[0], interpLat: pos[1], interpLon: pos[0], track: 300 })],
      })
    }
    let s = created() // lastQualifiedMs = 1000
    s = reduceHoldEntries(s, stalled(20000))
    expect(s.entries.get(HEX)?.divergedPolls).toBe(0) // distance flat → never diverges
    s = reduceHoldEntries(s, stalled(40000))
    expect(s.entries.has(HEX)).toBe(true)
    s = reduceHoldEntries(s, stalled(61000)) // 61000 − 1000 ≥ 60000 → stale
    expect(s.entries.size).toBe(0)
  })

  it('resets the diverging counter on a qualifying poll', () => {
    let s = created()
    s = reduceHoldEntries(s, divergingInput(2000, 6))
    s = reduceHoldEntries(s, divergingInput(3000, 7))
    expect(s.entries.get(HEX)?.divergedPolls).toBe(2)
    // Turns back toward the fix and qualifies again.
    const pos = dest(FIX, 5, 210)
    s = reduceHoldEntries(
      s,
      makeInput({
        nowMs: 4000,
        aircraft: [makeAc({ lat: pos[1], lon: pos[0], interpLat: pos[1], interpLon: pos[0] })],
      }),
    )
    const rec = s.entries.get(HEX)
    expect(rec).toBeDefined()
    expect(rec!.divergedPolls).toBe(0)
    expect(rec!.lastQualifiedMs).toBe(4000)
  })

  it('clears when the hex vanishes from the aircraft list', () => {
    const s2 = reduceHoldEntries(created(), makeInput({ aircraft: [] }))
    expect(s2.entries.size).toBe(0)
    expect(s2.lastDistNm.size).toBe(0)
  })
})

// ── LOFAL regression: freeze after first qualification (defect 2) ───────────

describe('reduceHoldEntries LOFAL freeze', () => {
  // LEFT-turn hold at LOFAL: drawn true inbound ≈ 145° (130M + 15E), racetrack
  // extends NW of the fix on the outbound side. Props deliberately disagree so
  // only the geometry derivation can produce the correct spec.
  const LOFAL_TRACK = holdTrack(FIX_LAT, FIX_LON, 145, false, 5)
  const lofalProc = makeProc({
    geojson: {
      type: 'FeatureCollection',
      features: [holdFeature({ inboundCourseMag: 310, turnRight: true }, LOFAL_TRACK)],
    },
  })
  const spec = collectHoldSpecs([lofalProc])[0]

  function inputAt(
    nowMs: number,
    radial: number,
    distOut: number,
    track: number,
    pred: PredictedPath,
  ): HoldEntryInput {
    const pos = dest(FIX, distOut, radial)
    return makeInput({
      nowMs,
      aircraft: [makeAc({ lat: pos[1], lon: pos[0], interpLat: pos[1], interpLon: pos[0], track })],
      predictions: new Map([[HEX, pred]]),
      specs: [spec],
    })
  }

  it('creates a DIRECT entry coincident with the drawn racetrack, then freezes it past the fix', () => {
    // ASA1508-style: NW of the fix arriving ~135° (r ≈ 10 for the left hold → direct).
    let s = reduceHoldEntries(emptyHoldEntryState(), inputAt(1000, 315, 5, 135, makePred(4000, 315)))
    const rec1 = s.entries.get(HEX)
    expect(rec1).toBeDefined()
    expect(rec1!.entry).toBe('direct')
    const onTrack = rec1!.path.filter((p) => Math.min(...LOFAL_TRACK.map((t) => distNm(p, t))) < 0.05)
    expect(onTrack.length / rec1!.path.length).toBeGreaterThan(0.8)

    // Pre-crossing: the predicted arrival track drifts to garbage (25° — the
    // old code re-classified to parallel and regenerated). Kind + path freeze.
    s = reduceHoldEntries(s, inputAt(2000, 315, 4, 135, makePred(4000, 205)))
    const rec2 = s.entries.get(HEX)!
    expect(rec2.entry).toBe('direct')
    expect(rec2.path).toBe(rec1!.path)
    expect(rec2.lastQualifiedMs).toBe(2000)

    // AT/past the fix: predicted points beyond the fix yield a RECIPROCAL
    // arrival track (325) — the old code re-classified and rebuilt the loop
    // flipped SE along the course axis. The frozen path must be identity-equal.
    s = reduceHoldEntries(s, inputAt(3000, 145, 0.4, 325, makePred(4000, 145)))
    const rec3 = s.entries.get(HEX)!
    expect(rec3.crossedFix).toBe(true)
    expect(rec3.entry).toBe('direct')
    expect(rec3.path).toBe(rec1!.path)
    expect(rec3.specKey).toBe(spec.key)
  })

  it('locks the spec once the fix is crossed (no switch to another hold mid-entry)', () => {
    let s = reduceHoldEntries(emptyHoldEntryState(), inputAt(1000, 315, 5, 135, makePred(4000, 315)))
    s = reduceHoldEntries(s, inputAt(2000, 145, 0.4, 325, makePred(4000, 145)))
    expect(s.entries.get(HEX)!.crossedFix).toBe(true)
    const before = s.entries.get(HEX)!

    // A second hold 3 nm NE now qualifies (the LOFAL trigger fails: the track
    // no longer points at LOFAL). The locked, in-progress entry must not jump.
    const OTHER: Pt = dest(FIX, 3, 55)
    const other = makeSpec({
      key: 'KXYZ-R34|OTHER',
      fixId: 'OTHER',
      fixLat: OTHER[1],
      fixLon: OTHER[0],
      inboundCourseTrue: 200,
      turnRight: true,
    })
    const pos = dest(FIX, 0.4, 145)
    const track = brg(pos, OTHER)
    const p1 = dest(OTHER, 2, brg(OTHER, pos))
    const predOther: PredictedPath = {
      hex: HEX,
      mode: 'straight',
      points: [
        { lon: p1[0], lat: p1[1], tSec: 60, altFt: 4000 },
        { lon: OTHER[0], lat: OTHER[1], tSec: 120, altFt: 4000 },
      ],
    }
    s = reduceHoldEntries(
      s,
      makeInput({
        nowMs: 3000,
        aircraft: [makeAc({ lat: pos[1], lon: pos[0], interpLat: pos[1], interpLon: pos[0], track })],
        predictions: new Map([[HEX, predOther]]),
        specs: [spec, other],
      }),
    )
    const after = s.entries.get(HEX)!
    expect(after.specKey).toBe(spec.key)
    expect(after.path).toBe(before.path)
    expect(after.entry).toBe(before.entry)
  })
})
