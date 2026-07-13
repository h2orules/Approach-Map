import { describe, it, expect } from 'vitest'
import { evaluateTrafficConflicts, alertsFromConflicts, type ConflictContext } from '../conflicts'
import type { ConflictPair, PredPoint, PredictedPath } from '../../types/path'
import type { InterpolatedAircraft } from '../../types/aircraft'

const D2R = Math.PI / 180
const LAT0 = 47.4
const LON0 = -122.3
const STEP_S = 5
const HORIZON_S = 300 // full 5-min predicted path; the evaluator clamps to its own horizon

/** Longitude degrees spanning `nm` at the fixture latitude. */
const lonNm = (nm: number) => nm / (60 * Math.cos(LAT0 * D2R))
/** Latitude degrees spanning `nm`. */
const latNm = (nm: number) => nm / 60

const NO_AIRPORTS: ConflictContext = { airports: [] }

interface AcSpec {
  hex: string
  lat: number
  lon: number
  track: number
  gsKt: number
  altFt: number
  baroRateFpm?: number
  altBaro?: number | 'ground'
  squawk?: string
  registration?: string
  flight?: string
}

/** Straight constant-rate predicted path on the 5 s grid (equirect motion). */
function pred(spec: AcSpec): PredictedPath {
  const rate = spec.baroRateFpm ?? 0
  const cosLat = Math.cos(spec.lat * D2R)
  const points: PredPoint[] = []
  for (let t = 0; t <= HORIZON_S; t += STEP_S) {
    const dNm = (spec.gsKt * t) / 3600
    points.push({
      lat: spec.lat + (dNm * Math.cos(spec.track * D2R)) / 60,
      lon: spec.lon + (dNm * Math.sin(spec.track * D2R)) / (60 * cosLat),
      tSec: t,
      altFt: spec.altFt + (rate / 60) * t,
    })
  }
  return { hex: spec.hex, mode: 'straight', points }
}

function makeAc(spec: AcSpec): InterpolatedAircraft {
  return {
    hex: spec.hex,
    flight: spec.flight ?? spec.hex.toUpperCase(),
    registration: spec.registration ?? `N${spec.hex.toUpperCase()}`,
    typeCode: 'B738',
    lat: spec.lat,
    lon: spec.lon,
    altBaro: spec.altBaro ?? spec.altFt,
    altGeom: spec.altFt,
    groundspeed: spec.gsKt,
    track: spec.track,
    baroRate: spec.baroRateFpm ?? 0,
    squawk: spec.squawk ?? '3421',
    lastPollMs: 0,
    interpLat: spec.lat,
    interpLon: spec.lon,
  }
}

function scenario(specs: AcSpec[]) {
  const predictions = new Map<string, PredictedPath>()
  const acByHex = new Map<string, InterpolatedAircraft>()
  for (const s of specs) {
    predictions.set(s.hex, pred(s))
    acByHex.set(s.hex, makeAc(s))
  }
  return { predictions, acByHex }
}

function run(specs: AcSpec[], ctx: ConflictContext = NO_AIRPORTS): ConflictPair[] {
  const { predictions, acByHex } = scenario(specs)
  return evaluateTrafficConflicts(predictions, acByHex, ctx)
}

/** Head-on pair at SL5 altitude: A eastbound at LON0, B westbound `rangeNm` east. */
function headOn(rangeNm: number, altA: number, altB: number, over: Partial<AcSpec>[] = [{}, {}]): AcSpec[] {
  return [
    { hex: 'aaa111', lat: LAT0, lon: LON0, track: 90, gsKt: 180, altFt: altA, ...over[0] },
    { hex: 'bbb222', lat: LAT0, lon: LON0 + lonNm(rangeNm), track: 270, gsKt: 180, altFt: altB, ...over[1] },
  ]
}

describe('evaluateTrafficConflicts — TCAS tau tiers (head-on at 5000 MSL, SL5)', () => {
  // 360 kt closure. 3.9 nm → tau 39 s: inside TA tau (40) but outside RA tau
  // (25), and range stays >1.3 nm through the 25 s radar-warning window so the
  // radar tier can't outrank the TA.
  it('fires a TA when tau crosses the TA threshold but not RA', () => {
    const pairs = run(headOn(3.9, 5000, 5000))
    expect(pairs).toHaveLength(1)
    expect(pairs[0].tier).toBe('ta')
    expect(pairs[0].raSenseA).toBeUndefined()
    expect(pairs[0].raSenseB).toBeUndefined()
    expect(pairs[0].cpaDAltFt).toBe(0)
  })

  // 2.0 nm → tau 20 s ≤ RA tau 25 s.
  it('fires an RA as the geometry tightens (TA-before-RA ordering)', () => {
    const ta = run(headOn(3.9, 5000, 5000))[0]
    const ra = run(headOn(2.0, 5000, 5000))[0]
    expect(ta.tier).toBe('ta')
    expect(ra.tier).toBe('ra')
    expect(ra.hexA).toBe('aaa111')
    expect(ra.hexB).toBe('bbb222')
    expect(ra.cpaTimeS).toBe(20)
    expect(ra.cpaNm).toBeCloseTo(0, 3)
    // Complementary senses always accompany an RA.
    expect([ra.raSenseA, ra.raSenseB].sort()).toEqual(['climb', 'descend'])
  })
})

describe('evaluateTrafficConflicts — proximity (DMOD/ZTHR) triggering', () => {
  // Parallel co-speed tracks: closure 0 → tau Infinity, so only the DMOD/ZTHR
  // proximity box can trigger. 0.52 nm is inside SL5's RA DMOD (0.55) but just
  // outside FORMATION_SUPPRESS_NM (0.5) — a genuinely tighter separation would
  // be indistinguishable from the formation/duplicate-track case below, which
  // is exactly the point of that gate.
  it('zero closure inside the RA DMOD/ZTHR box → ra via proximity', () => {
    const pairs = run([
      { hex: 'aaa111', lat: LAT0, lon: LON0, track: 90, gsKt: 180, altFt: 5000 },
      { hex: 'bbb222', lat: LAT0 + latNm(0.52), lon: LON0, track: 90, gsKt: 180, altFt: 5000 },
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0].tier).toBe('ra')
    expect(pairs[0].cpaTimeS).toBe(0)
    expect(pairs[0].cpaNm).toBeCloseTo(0.52, 3)
    expect([pairs[0].raSenseA, pairs[0].raSenseB].sort()).toEqual(['climb', 'descend'])
  })

  // 0.6 nm sits between SL5's RA DMOD (0.55) and TA DMOD (0.75), so the TA
  // proximity condition is satisfied. These two are on parallel co-speed tracks
  // at CONSTANT 0.6 nm separation — nothing is converging — so the radar tier's
  // convergence gate suppresses the radar warning it would otherwise inherit.
  // TCAS DMOD/ZTHR proximity is unchanged, so it surfaces as the bare 'ta'.
  it('zero closure between RA and TA DMOD, stable → ta (radar convergence gate suppresses the warning)', () => {
    const pairs = run([
      { hex: 'aaa111', lat: LAT0, lon: LON0, track: 90, gsKt: 180, altFt: 5000 },
      { hex: 'bbb222', lat: LAT0 + latNm(0.6), lon: LON0, track: 90, gsKt: 180, altFt: 5000 },
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0].tier).toBe('ta')
    expect(pairs[0].raSenseA).toBeUndefined()
  })
})

describe('evaluateTrafficConflicts — RA sense selection', () => {
  it('gives the higher aircraft climb when both senses reach ALIM', () => {
    // A level at 5200, B level at 5000, head-on RA (tau 20 s, CPA t=20).
    // Both senses exceed ALIM 350 (950 vs 550 ft) → higher (A) climbs.
    const pairs = run(headOn(2.0, 5200, 5000))
    expect(pairs).toHaveLength(1)
    expect(pairs[0].tier).toBe('ra')
    expect(pairs[0].raSenseA).toBe('climb')
    expect(pairs[0].raSenseB).toBe('descend')
  })

  it('chooses the crossing sense when only higher-descends reaches ALIM', () => {
    // A 4500 ft at −1000 fpm, B 4900 ft at −3000 fpm, CPA at t=15 (1.5 nm
    // head-on, 360 kt closure). Projected at CPA: A 4250 > B 4150, so A is
    // the "higher" aircraft — but A-climbs/B-descends only opens 267 ft
    // (< ALIM 300 at SL4) because B's steep descent eats the escape, while
    // the crossing sense (A descends, B climbs) opens 733 ft ≥ ALIM.
    const pairs = run(
      headOn(1.5, 4500, 4900, [{ baroRateFpm: -1000 }, { baroRateFpm: -3000 }]),
    )
    expect(pairs).toHaveLength(1)
    expect(pairs[0].tier).toBe('ra')
    expect(pairs[0].cpaTimeS).toBe(15)
    expect(pairs[0].raSenseA).toBe('descend')
    expect(pairs[0].raSenseB).toBe('climb')
  })
})

describe('evaluateTrafficConflicts — radar tier', () => {
  // Perpendicular-offset head-on crossing: A eastbound, B westbound offset
  // `sepNm` north, positioned to pass abeam at `tAbeamS`.
  function offsetCrossing(sepNm: number, dAltFt: number, tAbeamS: number, gsKt: number): AcSpec[] {
    const alongNm = (gsKt * tAbeamS) / 3600 // each covers this before abeam
    return [
      { hex: 'aaa111', lat: LAT0, lon: LON0 - lonNm(alongNm), track: 90, gsKt, altFt: 5000 },
      { hex: 'bbb222', lat: LAT0 + latNm(sepNm), lon: LON0 + lonNm(alongNm), track: 270, gsKt, altFt: 5000 + dAltFt },
    ]
  }

  it('CPA 1.9 nm / 1100 ft at t=40 → alert', () => {
    // 1100 ft > every TA/RA ZTHR and min sep 1.9 > warn's 1.3 nm, so only the
    // radar alert box (2.0 nm / 1200 ft, t ≤ 45) catches it.
    const pairs = run(offsetCrossing(1.9, 1100, 40, 180))
    expect(pairs).toHaveLength(1)
    expect(pairs[0].tier).toBe('alert')
    expect(pairs[0].cpaTimeS).toBe(40)
    expect(pairs[0].cpaNm).toBeCloseTo(1.9, 2)
    expect(pairs[0].cpaDAltFt).toBeCloseTo(1100, 6)
  })

  it('CPA 1.2 nm / 400 ft at t=20 → warning', () => {
    const pairs = run(offsetCrossing(1.2, 400, 20, 180))
    expect(pairs).toHaveLength(1)
    expect(pairs[0].tier).toBe('warning')
    expect(pairs[0].cpaTimeS).toBe(20)
    expect(pairs[0].cpaNm).toBeCloseTo(1.2, 2)
  })

  it('VFR-vs-VFR converging pair → radar tier inhibited, no pair', () => {
    // Same geometry as the 1.9 nm / 1100 ft radar-alert case, but both aircraft
    // squawk 1200. STARS Conflict Alert is inhibited for VFR-vs-VFR pairs
    // (controllers don't separate VFRs), so the radar tier must not fire. The
    // TCAS tier is unaffected but stays quiet here on its own: cpaDAlt 1100 ft
    // exceeds every TA ZTHR (850) and range never enters a TA DMOD box, so tau
    // never latches a TA → no pair at all.
    const specs = offsetCrossing(1.9, 1100, 40, 180)
    specs[0].squawk = '1200'
    specs[1].squawk = '1200'
    expect(run(specs)).toHaveLength(0)
  })

  it('the same converging geometry VFR-vs-IFR → radar alert as before', () => {
    // One aircraft carries a discrete code, so the VFR-vs-VFR inhibit does not
    // apply and the radar tier alerts exactly as the all-IFR case does.
    const specs = offsetCrossing(1.9, 1100, 40, 180)
    specs[0].squawk = '1200'
    const pairs = run(specs)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].tier).toBe('alert')
  })

  it('stable parallel tracks inside the radar window → no radar tier, no pair', () => {
    // Two aircraft on long final, 0.6 nm abeam, identical track/speed/altitude:
    // separation is constant, so nothing is converging into the radar window and
    // the convergence gate must suppress the radar tier entirely. 0.6 nm sits
    // inside the radar warn window (1.3 nm) — WITHOUT the gate this would surface
    // as a 'warning'. Altitude 4000 MSL → SL4 (agl Infinity, no ctx airport), and
    // 0.6 nm > SL4's TA DMOD (0.48) and RA DMOD (0.35) so no TCAS proximity fires
    // either; tau is infinite (zero closure) so no tau-based TA/RA. Net: no pair.
    const pairs = run([
      { hex: 'aaa111', lat: LAT0, lon: LON0, track: 90, gsKt: 180, altFt: 4000 },
      { hex: 'bbb222', lat: LAT0 + latNm(0.6), lon: LON0, track: 90, gsKt: 180, altFt: 4000 },
    ])
    expect(pairs).toHaveLength(0)
  })

  it('the same 1.2 nm / 400 ft geometry at t=60 → neither radar tier (no pair)', () => {
    // Faster closure keeps them >2.0 nm through the whole 45 s alert window
    // (2.33 nm at t=45) and tau at t=0 is ~61 s > every TA tau.
    const pairs = run(offsetCrossing(1.2, 400, 60, 240))
    expect(pairs).toHaveLength(0)
  })
})

describe('evaluateTrafficConflicts — non-conflicts and prefilter', () => {
  it('diverging aircraft produce no pair', () => {
    const pairs = run([
      { hex: 'aaa111', lat: LAT0, lon: LON0, track: 90, gsKt: 180, altFt: 5000 },
      { hex: 'bbb222', lat: LAT0, lon: LON0 - lonNm(3), track: 270, gsKt: 180, altFt: 5000 },
    ])
    expect(pairs).toHaveLength(0)
  })

  it('prefilter: 40 nm apart → skipped', () => {
    const pairs = run([
      { hex: 'aaa111', lat: LAT0, lon: LON0, track: 90, gsKt: 400, altFt: 10000 },
      { hex: 'bbb222', lat: LAT0, lon: LON0 + lonNm(40), track: 270, gsKt: 400, altFt: 10000 },
    ])
    expect(pairs).toHaveLength(0)
  })

  it('prefilter: 8000 ft apart with low vertical closure → skipped', () => {
    const pairs = run([
      { hex: 'aaa111', lat: LAT0, lon: LON0, track: 90, gsKt: 180, altFt: 5000 },
      { hex: 'bbb222', lat: LAT0 + latNm(0.3), lon: LON0, track: 90, gsKt: 180, altFt: 13000 },
    ])
    expect(pairs).toHaveLength(0)
  })

  it('excludes aircraft reporting on-ground', () => {
    const specs = headOn(2.0, 5000, 5000)
    specs[1].altBaro = 'ground'
    expect(run(specs)).toHaveLength(0)
  })
})

describe('evaluateTrafficConflicts — low-AGL near-airport suppression', () => {
  // Head-on at 300 ft, 1.5 nm apart — normally a solid conflict.
  const specs = headOn(1.5, 300, 300)

  it('suppresses when both are <400 AGL within 3 nm of a ctx airport', () => {
    const ctx: ConflictContext = {
      airports: [{ lat: LAT0, lon: LON0 + lonNm(0.75), elevationFt: 0 }],
    }
    expect(run(specs, ctx)).toHaveLength(0)
  })

  it('keeps the same geometry when no ctx airport is nearby', () => {
    const ctx: ConflictContext = {
      airports: [{ lat: LAT0 + latNm(100), lon: LON0, elevationFt: 0 }],
    }
    const pairs = run(specs, ctx)
    expect(pairs).toHaveLength(1)
    // 300 AGL is SL2 (TA-only): the TA fires but the radar warning outranks it.
    expect(pairs[0].tier).toBe('warning')
    expect(pairs[0].raSenseA).toBeUndefined()
  })
})

describe('evaluateTrafficConflicts — formation / duplicate-track suppression', () => {
  // Two co-moving aircraft 0.3 nm abeam on the same track/speed/altitude —
  // inside what would otherwise be RA DMOD/ZTHR proximity (see the "zero
  // closure inside the RA DMOD/ZTHR box" case above at 0.5 nm).
  function formationPair(over: Partial<AcSpec>[] = [{}, {}]): AcSpec[] {
    return [
      { hex: 'aaa111', lat: LAT0, lon: LON0, track: 90, gsKt: 180, altFt: 5000, ...over[0] },
      { hex: 'bbb222', lat: LAT0 + latNm(0.3), lon: LON0, track: 90, gsKt: 180, altFt: 5000, ...over[1] },
    ]
  }

  it('co-moving pair (0.3 nm abeam, matched track/speed/alt) -> suppressed, no pair at all', () => {
    const pairs = run(formationPair())
    expect(pairs).toHaveLength(0)
  })

  it('same positions but tracks 30° apart -> pair evaluated (not suppressed by this gate)', () => {
    const pairs = run(formationPair([{}, { track: 120 }]))
    expect(pairs.length).toBeGreaterThan(0)
  })

  it('same track but speeds 40 kt apart -> pair evaluated (not suppressed by this gate)', () => {
    const pairs = run(formationPair([{}, { gsKt: 220 }]))
    expect(pairs.length).toBeGreaterThan(0)
  })
})

describe('evaluateTrafficConflicts — TIS-B shadow suppression', () => {
  /** Point `nm` from (lat, lon) at compass bearing `bearingDeg`. */
  function offsetBearing(lat: number, lon: number, bearingDeg: number, nm: number) {
    const cosLat = Math.cos(lat * D2R)
    return {
      lat: lat + (nm * Math.cos(bearingDeg * D2R)) / 60,
      lon: lon + (nm * Math.sin(bearingDeg * D2R)) / (60 * cosLat),
    }
  }

  // Field case: an MLAT-only target (a6d675) and a '~' TIS-B trackfile of the
  // SAME airplane, ~35 s stale, trailing ~1.1 nm behind on a matched course
  // (4500/4600 ft, 122/118 kt, track 340/342). 1.1 nm is well outside
  // FORMATION_SUPPRESS_NM (0.5) — the formation gate misses it — but inside
  // TISB_SHADOW_NM (2.5), and every other delta (100 ft, 2°, 4 kt) is inside
  // its wider tolerances too.
  function tisbShadowPair(over: Partial<AcSpec>[] = [{}, {}]): AcSpec[] {
    const behind = offsetBearing(LAT0, LON0, 340 + 180, 1.1)
    return [
      { hex: 'a6d675', lat: LAT0, lon: LON0, track: 340, gsKt: 122, altFt: 4500, ...over[0] },
      { hex: '~2ba559', lat: behind.lat, lon: behind.lon, track: 342, gsKt: 118, altFt: 4600, ...over[1] },
    ]
  }

  it('MLAT target + TIS-B twin 1.1 nm in-trail, 100 ft / 2° / 4 kt apart -> suppressed, no pair', () => {
    const pairs = run(tisbShadowPair())
    expect(pairs).toHaveLength(0)
  })

  it('a converging pair where one side is TIS-B but tracks differ by 180° -> still alerts', () => {
    // Reuses the known "fires a TA" head-on geometry (3.9 nm, 5000/5000 ft)
    // but tags one hex '~'. bearingDelta(90, 270) = 180° >> TISB_SHADOW_TRK_DEG
    // (15°), so the shadow gate must not apply, proving it is selective on
    // co-moving track rather than blanket-suppressing any pair touching a
    // TIS-B hex.
    const specs = headOn(3.9, 5000, 5000)
    specs[1].hex = '~bbb222'
    const pairs = run(specs)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].tier).toBe('ta')
  })
})

describe('evaluateTrafficConflicts — same-registration/callsign dedupe', () => {
  it('same registration inside RA geometry -> suppressed, no pair', () => {
    const specs = headOn(2.0, 5000, 5000) // otherwise fires an RA (see TCAS suite above)
    specs[0].registration = 'N123AB'
    specs[1].registration = 'N123AB'
    expect(run(specs)).toHaveLength(0)
  })

  it('same flight/callsign inside RA geometry -> suppressed, no pair', () => {
    const specs = headOn(2.0, 5000, 5000)
    specs[0].flight = 'UAL123'
    specs[1].flight = 'UAL123'
    expect(run(specs)).toHaveLength(0)
  })

  it('distinct registration and callsign -> pair evaluated normally (ra)', () => {
    const pairs = run(headOn(2.0, 5000, 5000))
    expect(pairs).toHaveLength(1)
    expect(pairs[0].tier).toBe('ra')
  })
})

describe('alertsFromConflicts', () => {
  const base = { cpaTimeS: 30, cpaNm: 1.0, cpaDAltFt: 200 }

  it('keeps the worst tier per hex and threads otherHex', () => {
    const pairs: ConflictPair[] = [
      { hexA: 'aaa', hexB: 'bbb', tier: 'ta', ...base },
      { hexA: 'aaa', hexB: 'ccc', tier: 'warning', ...base },
    ]
    const alerts = alertsFromConflicts(pairs)
    expect(alerts.get('aaa')).toEqual({ kind: 'traffic', tier: 'warning', otherHex: 'ccc' })
    expect(alerts.get('bbb')).toEqual({ kind: 'traffic', tier: 'ta', otherHex: 'aaa' })
    expect(alerts.get('ccc')).toEqual({ kind: 'traffic', tier: 'warning', otherHex: 'aaa' })
  })

  it('threads each side\'s RA sense through and ranks ra above all', () => {
    const pairs: ConflictPair[] = [
      { hexA: 'aaa', hexB: 'bbb', tier: 'warning', ...base },
      { hexA: 'aaa', hexB: 'ddd', tier: 'ra', raSenseA: 'climb', raSenseB: 'descend', ...base },
    ]
    const alerts = alertsFromConflicts(pairs)
    expect(alerts.get('aaa')).toEqual({ kind: 'traffic', tier: 'ra', raSense: 'climb', otherHex: 'ddd' })
    expect(alerts.get('ddd')).toEqual({ kind: 'traffic', tier: 'ra', raSense: 'descend', otherHex: 'aaa' })
    expect(alerts.get('bbb')?.tier).toBe('warning')
  })
})
