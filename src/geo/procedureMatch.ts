import * as turf from '@turf/turf'
import type { InterpolatedAircraft } from '../types/aircraft'
import type { Procedure, ProcedureType, ProcedureLeg, AltConstraint } from '../types/procedure'
import { resolveAltConstraint } from '../utils/altitudeConstraint'
import { NEAR_AIRPORT_DISTANCE_NM, GS_FEET_PER_NM } from '../config/constants'
import { matchPointToLine, segmentFraction } from './lineMatching'
import { dmeArc } from './procedureShapes'

export interface MatchTolerances {
  crossTrackApproachNm: number
  crossTrackSidStarNm: number
  directionToleranceDeg: number
  altConstrainedFt: number
  altNearFt: number
  altFarFt: number
}

export interface MatchEvidence {
  crossTrackNm: number
  segIdx: number
  /** Along-track position (nm from the line's start). The reducer uses the
   *  delta between first and latest match to require real progress. */
  alongTrackNm: number
  /** Altitude agrees with the expected profile. Evidence only — the reducer,
   *  not this function, decides whether alt failure sheds a track. */
  altOk: boolean
  /** Nearest segment lies before the MAP (or the procedure has no MAP gate). */
  preMap: boolean
  /** Nearest segment lies at/after the MAP (approach missed-segment territory). */
  pastMap: boolean
}

export interface AirportContext {
  lat: number
  lon: number
  elevationFt: number
}

function altitudePlausibleForType(type: ProcedureType, agl: number): boolean {
  switch (type) {
    case 'SID': return agl >= -500 && agl <= 18000
    case 'STAR': return agl >= 500 && agl <= 25000
    case 'APPROACH': return agl >= -500 && agl <= 10000
  }
}

/** True when the constraint pins the aircraft to a specific altitude band (not just a floor/ceiling). */
function isExactConstraint(c: AltConstraint | null): boolean {
  return c?.type === 'AT' || c?.type === 'BETWEEN'
}

/** FAF data for precision GS altitude projection. */
interface GsInfo {
  fafWptIdx: number
  fafLat: number
  fafLon: number
  fafAlt: number
}

/**
 * Index of the MAP waypoint in proc.waypoints, or -1 if not found.
 * ARINC 424 description code 4 = 'M' is parsed as role 'map'.
 */
function findMapWptIdx(proc: Procedure): number {
  const mapSym = proc.symbols.find((s) => s.role === 'map')
  if (!mapSym) return -1
  return proc.waypoints.findIndex((w) => w.id === mapSym.id)
}

/**
 * Locate the GS FAF waypoint for ILS approaches. Returns null for all other
 * procedure types or when the FAF altitude constraint is absent.
 */
function findGsInfo(proc: Procedure): GsInfo | null {
  if (proc.type !== 'APPROACH') return null
  const fafSym = proc.symbols.find((s) => s.gsFaf)
  if (!fafSym) return null
  const fafIdx = proc.waypoints.findIndex((w) => w.id === fafSym.id)
  if (fafIdx < 0) return null
  const fafWpt = proc.waypoints[fafIdx]
  const fafAlt = resolveAltConstraint(fafWpt.altConstraint)
  if (fafAlt === null) return null
  return { fafWptIdx: fafIdx, fafLat: fafWpt.lat, fafLon: fafWpt.lon, fafAlt }
}

/**
 * A DME-arc feeder rendered as a match path: the arc-sampled coordinate run of
 * one transition that contains an `AF` (arc-to-fix) leg, plus a per-coordinate
 * map back to the source leg (for altitude/role bracketing). See
 * `buildArcMatchPaths` for why these are matched separately from the
 * representative path.
 */
export interface ArcMatchPath {
  coords: [number, number][]
  legs: ProcedureLeg[]
  /** coords[k] belongs to (arrives at) legs[legIdx[k]]. */
  legIdx: number[]
}

/**
 * Detection paths for a procedure's DME-arc feeder transitions. A DME arc (`AF`
 * leg) is flown as a curve, not the straight chord `proc.waypoints` encodes,
 * and arc feeders usually live in their own transitions — NOT the
 * representative/longest one detection matches by default (e.g. KPAE VOR-A: the
 * arc is on the ECEPO/NICIT/CEVLI feeders, the representative is the straight
 * final). So an aircraft on the arc is both far from the chord and absent from
 * the matched path. Each transition that contains an arc leg becomes its own
 * arc-sampled match path (inbound portion, up to the MAP), with every sampled
 * point tagged to its source leg so altitude evidence still brackets correctly.
 */
export function buildArcMatchPaths(proc: Procedure): ArcMatchPath[] {
  const transitions = proc.transitions
  if (!transitions) return []
  const paths: ArcMatchPath[] = []
  for (const t of transitions) {
    if (!t.legs.some((l) => l.pathTerm === 'AF' && l.arc)) continue
    const mapIdx = t.legs.findIndex((l) => l.role === 'map')
    const inbound = mapIdx >= 0 ? t.legs.slice(0, mapIdx + 1) : t.legs
    const coords: [number, number][] = []
    const legIdx: number[] = []
    for (let i = 0; i < inbound.length; i++) {
      const l = inbound[i]
      if (l.pathTerm === 'AF' && l.arc && i > 0) {
        const prev = inbound[i - 1]
        const arc = dmeArc(l.arc.centerLat, l.arc.centerLon, prev.lat, prev.lon, l.lat, l.lon, l.turnRight)
        for (let k = 1; k < arc.length; k++) {
          coords.push(arc[k])
          legIdx.push(i)
        }
      } else {
        coords.push([l.lon, l.lat])
        legIdx.push(i)
      }
    }
    if (coords.length >= 2) paths.push({ coords, legs: inbound, legIdx })
  }
  return paths
}

export interface PreparedProcedure {
  coords: [number, number][]
  gsInfo: GsInfo | null
  /** MAP waypoint index for approaches, else -1 (gate disabled). */
  mapWptIdx: number
  /** Arc-sampled feeder paths matched in addition to the representative. */
  arcPaths: ArcMatchPath[]
}

const prepCache = new WeakMap<Procedure, PreparedProcedure | null>()

/**
 * Per-procedure derived data (coords array, GS info, MAP index, arc feeder
 * paths), memoized by procedure identity — safe because `procedures` is
 * replaced (new array/objects) when the airport or AIRAC cycle changes.
 */
export function prepareProcedure(proc: Procedure): PreparedProcedure | null {
  const cached = prepCache.get(proc)
  if (cached !== undefined) return cached
  const result =
    !proc.hasGeometry || proc.waypoints.length < 2
      ? null
      : {
          coords: proc.waypoints.map((w) => [w.lon, w.lat] as [number, number]),
          gsInfo: findGsInfo(proc),
          mapWptIdx: proc.type === 'APPROACH' ? findMapWptIdx(proc) : -1,
          arcPaths: buildArcMatchPaths(proc),
        }
  prepCache.set(proc, result)
  return result
}

/**
 * Instantaneous per-(aircraft, procedure) evidence. Returns null when the
 * aircraft is off the line, off-direction, on the ground, or the procedure has
 * no usable geometry. Never gates on altitude or MAP position — those are
 * reported as flags so the detection reducer owns all temporal/memory policy.
 *
 * Matches the representative path and every DME-arc feeder path (see
 * `buildArcMatchPaths`), returning the evidence from whichever the aircraft is
 * laterally closest to. The reducer keys tracks by (hex, procedure), so an
 * aircraft handing off from an arc feeder to the straight final stays on one
 * track — approaches don't require net along-track progress, so the per-path
 * `alongTrackNm` reset at the handoff is harmless.
 */
export function evaluateMatch(
  ac: InterpolatedAircraft,
  proc: Procedure,
  ctx: AirportContext,
  tol: MatchTolerances,
): MatchEvidence | null {
  const prepared = prepareProcedure(proc)
  if (!prepared) return null
  if (ac.altBaro === 'ground') return null

  let best = evaluateRepresentative(ac, proc, ctx, tol, prepared)
  for (const arc of prepared.arcPaths) {
    const ev = evaluateArcPath(ac, proc, ctx, tol, arc)
    if (ev && (best === null || ev.crossTrackNm < best.crossTrackNm)) best = ev
  }
  return best
}

/** Representative-path evidence — the straight waypoint polyline with GS/MAP
 *  altitude modeling. Extracted from `evaluateMatch`; behavior unchanged. */
function evaluateRepresentative(
  ac: InterpolatedAircraft,
  proc: Procedure,
  ctx: AirportContext,
  tol: MatchTolerances,
  prepared: PreparedProcedure,
): MatchEvidence | null {
  const altFt = ac.altBaro as number

  const maxCrossTrackNm =
    proc.type === 'APPROACH' ? tol.crossTrackApproachNm : tol.crossTrackSidStarNm
  const match = matchPointToLine(prepared.coords, ac.interpLat, ac.interpLon, ac.track, {
    maxCrossTrackNm,
    directionToleranceDeg: tol.directionToleranceDeg,
  })
  if (!match) return null

  const { crossTrackNm, segIdx, segStart, segEnd, nearestCoords, alongTrackNm } = match
  const acPt = turf.point([ac.interpLon, ac.interpLat])

  const distToAirport = turf.distance(acPt, turf.point([ctx.lon, ctx.lat]), {
    units: 'nauticalmiles',
  })
  const fallbackThreshold = distToAirport <= NEAR_AIRPORT_DISTANCE_NM ? tol.altNearFt : tol.altFarFt

  const wptBefore = proc.waypoints[segIdx]
  const wptAfter = proc.waypoints[Math.min(segIdx + 1, proc.waypoints.length - 1)]

  // ── Pre/past-MAP classification (approaches with a known MAP only) ──────────
  let preMap = true
  let pastMap = false
  if (prepared.mapWptIdx >= 0) {
    if (segIdx < prepared.mapWptIdx) {
      preMap = true
      pastMap = false
    } else {
      preMap = false
      pastMap = true
    }
  }

  // ── Expected-altitude profile ───────────────────────────────────────────────
  let expectedAlt: number | null = null
  let tight = false // use altConstrainedFt instead of near/far fallback

  const { gsInfo } = prepared
  if (gsInfo !== null && segIdx >= gsInfo.fafWptIdx) {
    // On or past the FAF on a precision approach: project along the 3° GS.
    const distFromFafNm = turf.distance(acPt, turf.point([gsInfo.fafLon, gsInfo.fafLat]), {
      units: 'nauticalmiles',
    })
    expectedAlt = gsInfo.fafAlt - distFromFafNm * GS_FEET_PER_NM
    tight = true
  } else {
    // Linear interpolation between the two bracketing waypoints.
    const frac = segmentFraction(segStart, segEnd, nearestCoords)
    const altBefore = resolveAltConstraint(wptBefore.altConstraint)
    const altAfter = resolveAltConstraint(wptAfter.altConstraint)

    if (altBefore !== null && altAfter !== null) {
      expectedAlt = altBefore + (altAfter - altBefore) * frac
      // Only tighten when both constraints pin the altitude precisely.
      tight = isExactConstraint(wptBefore.altConstraint) && isExactConstraint(wptAfter.altConstraint)
    } else if (altBefore !== null) {
      expectedAlt = altBefore
    } else if (altAfter !== null) {
      expectedAlt = altAfter
    }
  }

  let altOk: boolean
  if (expectedAlt === null) {
    altOk = altitudePlausibleForType(proc.type, altFt - ctx.elevationFt)
  } else {
    const threshold = tight ? tol.altConstrainedFt : fallbackThreshold
    altOk = Math.abs(altFt - expectedAlt) <= threshold
  }

  return { crossTrackNm, segIdx, alongTrackNm, altOk, preMap, pastMap }
}

/**
 * Evidence for one DME-arc feeder path. Same cross-track/direction gate and
 * altitude modeling as the representative, but bracketing altitudes come from
 * the feeder's own legs (tagged per sampled point). Arc feeders are entirely
 * before the MAP, so `preMap` is always true (no GS projection — a feeder arc
 * is never the final-approach segment).
 */
function evaluateArcPath(
  ac: InterpolatedAircraft,
  proc: Procedure,
  ctx: AirportContext,
  tol: MatchTolerances,
  arc: ArcMatchPath,
): MatchEvidence | null {
  const altFt = ac.altBaro as number
  const maxCrossTrackNm =
    proc.type === 'APPROACH' ? tol.crossTrackApproachNm : tol.crossTrackSidStarNm
  const match = matchPointToLine(arc.coords, ac.interpLat, ac.interpLon, ac.track, {
    maxCrossTrackNm,
    directionToleranceDeg: tol.directionToleranceDeg,
  })
  if (!match) return null

  const { crossTrackNm, segIdx, segStart, segEnd, nearestCoords, alongTrackNm } = match
  const acPt = turf.point([ac.interpLon, ac.interpLat])
  const distToAirport = turf.distance(acPt, turf.point([ctx.lon, ctx.lat]), {
    units: 'nauticalmiles',
  })
  const fallbackThreshold = distToAirport <= NEAR_AIRPORT_DISTANCE_NM ? tol.altNearFt : tol.altFarFt

  const legBefore = arc.legs[arc.legIdx[segIdx]]
  const legAfter = arc.legs[arc.legIdx[Math.min(segIdx + 1, arc.legIdx.length - 1)]]
  const frac = segmentFraction(segStart, segEnd, nearestCoords)
  const altBefore = resolveAltConstraint(legBefore.altConstraint)
  const altAfter = resolveAltConstraint(legAfter.altConstraint)

  let expectedAlt: number | null = null
  let tight = false
  if (altBefore !== null && altAfter !== null) {
    expectedAlt = altBefore + (altAfter - altBefore) * frac
    tight = isExactConstraint(legBefore.altConstraint) && isExactConstraint(legAfter.altConstraint)
  } else if (altBefore !== null) {
    expectedAlt = altBefore
  } else if (altAfter !== null) {
    expectedAlt = altAfter
  }

  let altOk: boolean
  if (expectedAlt === null) {
    altOk = altitudePlausibleForType(proc.type, altFt - ctx.elevationFt)
  } else {
    const threshold = tight ? tol.altConstrainedFt : fallbackThreshold
    altOk = Math.abs(altFt - expectedAlt) <= threshold
  }

  return { crossTrackNm, segIdx, alongTrackNm, altOk, preMap: true, pastMap: false }
}
