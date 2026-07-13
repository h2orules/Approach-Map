import * as turf from '@turf/turf'
import type { InterpolatedAircraft } from '../types/aircraft'
import type { Procedure, ProcedureTransition } from '../types/procedure'
import type { CifpRunwayInfo } from '../types/cifp'
import type { TrackPoint, PredPoint, PredictedPath } from '../types/path'
import {
  PREDICT_STEP_S,
  PREDICT_MAX_S,
  TURN_RATE_MIN_DPS,
  TURN_RATE_MAX_DPS,
  PREDICT_TURN_HOLD_S,
  PREDICT_TURN_DECAY_END_S,
  PREDICT_PROFILE_CAPTURE_FT,
  PREDICT_MIN_DESCENT_FPM,
  DETECT_CONFIRMED_XT_APPROACH_NM,
  DETECT_CONFIRMED_DIR_DEG,
  HOLD_MATCH_XT_NM,
  HOLD_MATCH_DIR_DEG,
} from '../config/constants'
import { matchPointToLine, bearingDelta } from './lineMatching'
import { prepareProcedure } from './procedureMatch'
import { pickProfileTransition, buildProfileModel, descentProfilePoints, alongTrackNm } from './profileMath'

const NM = { units: 'nauticalmiles' as const }

// ── Guidance ────────────────────────────────────────────────────────────────

type PathKind = 'representative' | 'arc' | 'hold'

/** One lateral guidance polyline the aircraft can be walked along. */
interface GuidancePath {
  kind: PathKind
  coords: [number, number][]
  /** Total length (nm) of the polyline. */
  lengthNm: number
  /** Last vertex, for straight extrapolation past the end. */
  lastCoord: [number, number]
  /** Bearing of the final segment, for straight extrapolation past the end. */
  lastBearing: number
  /**
   * Arc paths only: where the arc's end projects (along-track nm) onto the
   * representative path, so a walk that runs off the arc continues on the final.
   */
  junctionRepAlongNm?: number
}

/**
 * Cached lateral+vertical guidance for an aircraft assigned to a procedure.
 * WeakMap-keyed by Procedure identity (safe: `procedures` is replaced wholesale
 * on airport/AIRAC change). The lateral paths mirror detection's guidance set
 * (representative waypoint polyline + each DME-arc feeder + each hold racetrack);
 * the vertical model is the profile-panel recipe (final/common transition,
 * runway TDZE) reduced to its descent vertices.
 */
export interface Guidance {
  proc: Procedure
  paths: GuidancePath[]
  representative: GuidancePath
  /** Descent vertices (distNm from the profile transition start, altFt MSL). */
  profilePoints: { distNm: number; altFt: number }[]
  /** The profile transition, for projecting predicted points to profile distance. */
  transition: ProcedureTransition | null
  /** Vertical floor (ft MSL): the greater of field elevation and runway TDZE. */
  floorFt: number
}

const guidanceCache = new WeakMap<Procedure, Guidance | null>()
// prepareGuidance is memoized per (proc) but its inputs (rwy, fieldElev) could
// in principle change; they don't within a session for a given procedure, so
// the cache key is the procedure identity alone (matching prepareProcedure).

function makePath(kind: PathKind, coords: [number, number][]): GuidancePath | null {
  if (coords.length < 2) return null
  const lengthNm = turf.length(turf.lineString(coords), NM)
  const last = coords[coords.length - 1]
  const prev = coords[coords.length - 2]
  const lastBearing = turf.bearing(turf.point(prev), turf.point(last))
  return { kind, coords, lengthNm, lastCoord: last, lastBearing }
}

/**
 * Build (and cache) the guidance bundle for an assigned approach. `rwy` is the
 * runway end the profile model is built against (ProfilePanel recipe); when
 * null, `fieldElevFt` is substituted for the TDZE so glideslope-anchored
 * altitudes stay at field level instead of collapsing to sea level (which is
 * what buildProfileModel/glideslopeAltAt do with a null TDZE).
 */
export function prepareGuidance(
  proc: Procedure,
  rwy: CifpRunwayInfo | null,
  fieldElevFt: number,
): Guidance {
  const cached = guidanceCache.get(proc)
  if (cached) return cached

  const prepared = prepareProcedure(proc)
  const paths: GuidancePath[] = []

  const rep = prepared ? makePath('representative', prepared.coords) : null
  const representative: GuidancePath =
    rep ?? {
      kind: 'representative',
      coords: [],
      lengthNm: 0,
      lastCoord: [0, 0],
      lastBearing: 0,
    }
  if (rep) paths.push(rep)

  if (prepared) {
    for (const arc of prepared.arcPaths) {
      const p = makePath('arc', arc.coords)
      if (!p) continue
      const end = arc.coords[arc.coords.length - 1]
      if (rep) {
        const m = matchPointToLine(rep.coords, end[1], end[0], 0, {
          maxCrossTrackNm: Infinity,
          directionToleranceDeg: 360,
        })
        p.junctionRepAlongNm = m ? m.alongTrackNm : rep.lengthNm
      } else {
        p.junctionRepAlongNm = 0
      }
      paths.push(p)
    }
    for (const hold of prepared.holdPaths) {
      const p = makePath('hold', hold.coords)
      if (p) paths.push(p)
    }
  }

  // ── Vertical: the profile-panel recipe (final/common transition + runway). ──
  const transition = pickProfileTransition(proc)
  // A null TDZE makes glideslopeAltAt() anchor at sea level; synthesize a runway
  // end at field elevation so the anchor sits at the field instead.
  const effRwy: CifpRunwayInfo | null =
    rwy ?? { id: '', lat: 0, lon: 0, thresholdElevFt: fieldElevFt, lengthFt: null }
  let profilePoints: { distNm: number; altFt: number }[] = []
  if (transition) {
    const model = buildProfileModel(proc, transition, effRwy)
    profilePoints = descentProfilePoints(model)
  }
  const tdze = rwy?.thresholdElevFt ?? fieldElevFt
  const floorFt = Math.max(fieldElevFt, tdze)

  const guidance: Guidance = { proc, paths, representative, profilePoints, transition, floorFt }
  guidanceCache.set(proc, guidance)
  return guidance
}

// ── Turn-rate estimation ────────────────────────────────────────────────────

/** Signed smallest delta from bearing `a` to `b` (deg, −180..180). */
function signedTurn(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180
}

/**
 * Estimate the aircraft's current turn rate (deg/s, right = positive) from up to
 * the last three poll samples. Each consecutive pair contributes its signed
 * heading delta over Δt; pairs with Δt outside [1, 20] s are skipped (a stale or
 * duplicate sample), and the most recent pair is weighted double. Fewer than two
 * usable pairs returns 0.
 */
export function turnRateDps(recent: readonly TrackPoint[]): number {
  if (recent.length < 2) return 0
  const pts = recent.slice(-3)
  let weighted = 0
  let weightSum = 0
  for (let i = 1; i < pts.length; i++) {
    const dtS = (pts[i].tMs - pts[i - 1].tMs) / 1000
    if (dtS < 1 || dtS > 20) continue
    const omega = signedTurn(pts[i - 1].track, pts[i].track) / dtS
    const weight = i === pts.length - 1 ? 2 : 1
    weighted += omega * weight
    weightSum += weight
  }
  if (weightSum === 0) return 0
  return weighted / weightSum
}

/** Turn rate at time t, applying the hold-then-linear-decay envelope. */
function turnRateAt(omega0: number, tSec: number): number {
  if (tSec <= PREDICT_TURN_HOLD_S) return omega0
  if (tSec >= PREDICT_TURN_DECAY_END_S) return 0
  const frac = (PREDICT_TURN_DECAY_END_S - tSec) / (PREDICT_TURN_DECAY_END_S - PREDICT_TURN_HOLD_S)
  return omega0 * frac
}

// ── On-procedure test ───────────────────────────────────────────────────────

interface GateSpec {
  coords: [number, number][]
  xtLimitNm: number
  dirLimitDeg: number
}

/**
 * Is the aircraft currently within confirmed lateral+direction tolerance of any
 * guidance path (representative / arc / hold) of `proc`? Finds the laterally
 * closest path first (no direction gate), then applies that path's own gates,
 * so a holding aircraft (which turns continuously) is judged against the roomier
 * hold tolerances rather than the tight final-approach ones.
 */
export function isOnProcedureNow(ac: InterpolatedAircraft, proc: Procedure): boolean {
  if (ac.altBaro === 'ground') return false
  const prepared = prepareProcedure(proc)
  if (!prepared) return false

  const gates: GateSpec[] = []
  if (prepared.coords.length >= 2) {
    gates.push({
      coords: prepared.coords,
      xtLimitNm: DETECT_CONFIRMED_XT_APPROACH_NM,
      dirLimitDeg: DETECT_CONFIRMED_DIR_DEG,
    })
  }
  for (const arc of prepared.arcPaths) {
    if (arc.coords.length >= 2) {
      gates.push({
        coords: arc.coords,
        xtLimitNm: DETECT_CONFIRMED_XT_APPROACH_NM,
        dirLimitDeg: DETECT_CONFIRMED_DIR_DEG,
      })
    }
  }
  for (const hold of prepared.holdPaths) {
    if (hold.coords.length >= 2) {
      gates.push({ coords: hold.coords, xtLimitNm: HOLD_MATCH_XT_NM, dirLimitDeg: HOLD_MATCH_DIR_DEG })
    }
  }

  let bestGate: GateSpec | null = null
  let bestXt = Infinity
  let bestBearing = 0
  for (const g of gates) {
    const m = matchPointToLine(g.coords, ac.interpLat, ac.interpLon, ac.track, {
      maxCrossTrackNm: Infinity,
      directionToleranceDeg: 360,
    })
    if (!m) continue
    if (m.crossTrackNm < bestXt) {
      bestXt = m.crossTrackNm
      bestGate = g
      bestBearing = m.segBearing
    }
  }
  if (!bestGate) return false
  const lateralOk = bestXt <= bestGate.xtLimitNm
  const directionOk = bearingDelta(ac.track, bestBearing) <= bestGate.dirLimitDeg
  return lateralOk && directionOk
}

// ── Prediction ──────────────────────────────────────────────────────────────

/** Interpolate the descent profile altitude at an along-track distance (nm). */
function profileAltAt(points: { distNm: number; altFt: number }[], distNm: number): number {
  const n = points.length
  if (distNm <= points[0].distNm) return points[0].altFt
  const last = points[n - 1]
  if (distNm >= last.distNm) return last.altFt
  for (let i = 1; i < n; i++) {
    if (distNm <= points[i].distNm) {
      const a = points[i - 1]
      const b = points[i]
      const span = b.distNm - a.distNm
      const frac = span <= 0 ? 0 : (distNm - a.distNm) / span
      return a.altFt + (b.altFt - a.altFt) * frac
    }
  }
  return last.altFt
}

/** Position along one guidance path at a given along-track distance (nm). */
function positionAlong(
  path: GuidancePath,
  representative: GuidancePath,
  distNm: number,
): { lat: number; lon: number } {
  if (path.kind === 'hold' && path.lengthNm > 0) {
    const wrapped = distNm % path.lengthNm
    const c = turf.along(turf.lineString(path.coords), wrapped, NM).geometry.coordinates
    return { lat: c[1], lon: c[0] }
  }
  if (path.kind === 'arc') {
    if (distNm <= path.lengthNm) {
      const c = turf.along(turf.lineString(path.coords), distNm, NM).geometry.coordinates
      return { lat: c[1], lon: c[0] }
    }
    const repAlong = (path.junctionRepAlongNm ?? representative.lengthNm) + (distNm - path.lengthNm)
    return positionAlong(representative, representative, repAlong)
  }
  // representative
  if (distNm <= path.lengthNm && path.lengthNm > 0) {
    const c = turf.along(turf.lineString(path.coords), distNm, NM).geometry.coordinates
    return { lat: c[1], lon: c[0] }
  }
  // Past the end: extrapolate straight on the final segment bearing.
  const overshoot = distNm - path.lengthNm
  const dest = turf.destination(turf.point(path.lastCoord), Math.max(0, overshoot), path.lastBearing, NM)
  return { lat: dest.geometry.coordinates[1], lon: dest.geometry.coordinates[0] }
}

/** The guidance path the aircraft is laterally closest to (no direction gate). */
function closestGuidancePath(
  guidance: Guidance,
  ac: InterpolatedAircraft,
): { path: GuidancePath; alongNowNm: number } {
  let best = guidance.representative
  let bestAlong = 0
  let bestXt = Infinity
  for (const path of guidance.paths) {
    const m = matchPointToLine(path.coords, ac.interpLat, ac.interpLon, ac.track, {
      maxCrossTrackNm: Infinity,
      directionToleranceDeg: 360,
    })
    if (!m) continue
    if (m.crossTrackNm < bestXt) {
      bestXt = m.crossTrackNm
      best = path
      bestAlong = m.alongTrackNm
    }
  }
  return { path: best, alongNowNm: bestAlong }
}

function stepCount(horizonS: number): number {
  return Math.max(0, Math.floor(horizonS / PREDICT_STEP_S))
}

/** Predict along the assigned approach's guidance, riding the descent profile. */
function predictApproach(
  ac: InterpolatedAircraft,
  guidance: Guidance,
  horizonS: number,
): PredictedPath {
  const gs = ac.groundspeed
  const onGround = ac.altBaro === 'ground'
  const altNow = onGround ? guidance.floorFt : (ac.altBaro as number)
  const baroRate = onGround ? 0 : ac.baroRate
  const { path, alongNowNm } = closestGuidancePath(guidance, ac)

  const points: PredPoint[] = [
    { lon: ac.interpLon, lat: ac.interpLat, tSec: 0, altFt: altNow },
  ]
  let altPred = altNow
  const n = stepCount(horizonS)
  for (let i = 1; i <= n; i++) {
    const tSec = i * PREDICT_STEP_S
    const distAlong = alongNowNm + (gs * tSec) / 3600
    const pos = positionAlong(path, guidance.representative, distAlong)

    let target: number
    if (guidance.profilePoints.length >= 2) {
      const along = guidance.transition
        ? alongTrackNm(guidance.transition, pos.lat, pos.lon).distNm
        : distAlong
      target = profileAltAt(guidance.profilePoints, along)
    } else {
      target = altNow + (baroRate * tSec) / 60
    }

    const diff = target - altPred
    if (Math.abs(diff) <= PREDICT_PROFILE_CAPTURE_FT) {
      altPred = target
    } else {
      const rateFpm = Math.max(Math.abs(baroRate), PREDICT_MIN_DESCENT_FPM)
      const maxDelta = (rateFpm * PREDICT_STEP_S) / 60
      altPred += Math.sign(diff) * Math.min(maxDelta, Math.abs(diff))
    }
    // Never below the profile, never below the field/TDZE floor.
    altPred = Math.max(altPred, target, guidance.floorFt)

    points.push({ lon: pos.lon, lat: pos.lat, tSec, altFt: altPred })
  }

  return { hex: ac.hex, mode: 'approach', points }
}

/** Predict by turn-rate extrapolation (turning or straight dead-reckoning). */
function predictExtrapolated(
  ac: InterpolatedAircraft,
  recent: readonly TrackPoint[],
  fieldElevFt: number,
  horizonS: number,
  forceStraight: boolean,
): PredictedPath {
  let omega = forceStraight ? 0 : turnRateDps(recent)
  const turning = Math.abs(omega) >= TURN_RATE_MIN_DPS
  if (!turning) omega = 0
  else omega = Math.max(-TURN_RATE_MAX_DPS, Math.min(TURN_RATE_MAX_DPS, omega))

  const gs = ac.groundspeed
  const onGround = ac.altBaro === 'ground'
  const altNow = onGround ? fieldElevFt : (ac.altBaro as number)
  const baroRate = onGround ? 0 : ac.baroRate
  const floorFt = Math.max(0, fieldElevFt)

  let lat = ac.interpLat
  let lon = ac.interpLon
  let heading = ac.track
  const points: PredPoint[] = [{ lon, lat, tSec: 0, altFt: altNow }]

  const n = stepCount(horizonS)
  for (let i = 1; i <= n; i++) {
    const tPrev = (i - 1) * PREDICT_STEP_S
    heading = (heading + turnRateAt(omega, tPrev) * PREDICT_STEP_S + 360) % 360
    if (gs > 0) {
      const dest = turf.destination(
        turf.point([lon, lat]),
        (gs * PREDICT_STEP_S) / 3600,
        heading,
        NM,
      )
      lon = dest.geometry.coordinates[0]
      lat = dest.geometry.coordinates[1]
    }
    const tSec = i * PREDICT_STEP_S
    const altFt = Math.max(floorFt, altNow + (baroRate * tSec) / 60)
    points.push({ lon, lat, tSec, altFt })
  }

  return { hex: ac.hex, mode: turning ? 'turn' : 'straight', points }
}

/**
 * Predict an aircraft's path up to `horizonS` seconds ahead, at PREDICT_STEP_S
 * steps (point 0 = the current interpolated position). When the aircraft is
 * assigned to an approach (guidance non-null) AND currently established on one
 * of its guidance paths, the prediction follows the procedure laterally and the
 * published descent profile vertically ('approach'). Otherwise it extrapolates
 * the observed turn rate — decaying to straight flight — and the baro rate
 * ('turn' or 'straight'). TIS-B tracks (hex starting '~') are too noisy to
 * trust a turn rate from, so they are always extrapolated straight.
 */
export function predictPath(
  ac: InterpolatedAircraft,
  recent: readonly TrackPoint[],
  guidance: Guidance | null,
  fieldElevFt: number,
  horizonS: number = PREDICT_MAX_S,
): PredictedPath {
  const forceStraight = ac.hex.startsWith('~')
  const onProcedure =
    guidance !== null && !forceStraight && isOnProcedureNow(ac, guidance.proc)

  if (onProcedure && guidance) {
    return predictApproach(ac, guidance, horizonS)
  }
  return predictExtrapolated(ac, recent, fieldElevFt, horizonS, forceStraight)
}
