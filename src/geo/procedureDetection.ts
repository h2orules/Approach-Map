import * as turf from '@turf/turf'
import type { InterpolatedAircraft } from '../types/aircraft'
import type { Procedure, ProcedureType, ProcedureWaypoint, AltConstraint } from '../types/procedure'
import { resolveAltConstraint } from '../utils/altitudeConstraint'
import {
  CROSS_TRACK_THRESHOLD_NM,
  CROSS_TRACK_APPROACH_NM,
  ALT_THRESHOLD_NEAR_FT,
  ALT_THRESHOLD_FAR_FT,
  ALT_THRESHOLD_CONSTRAINED_FT,
  NEAR_AIRPORT_DISTANCE_NM,
  DIRECTION_TOLERANCE_DEG,
  GS_FEET_PER_NM,
} from '../config/constants'

function bearingDelta(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
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

/**
 * Proper 0–1 fraction of the nearest point within its segment.
 * turf.nearestPointOnLine `location` is total distance along the line (nm),
 * not a per-segment fraction — using it directly is a bug when the line is >1 nm.
 */
function segmentFraction(
  wptBefore: ProcedureWaypoint,
  wptAfter: ProcedureWaypoint,
  nearestCoords: [number, number],
): number {
  const a = turf.point([wptBefore.lon, wptBefore.lat])
  const b = turf.point([wptAfter.lon, wptAfter.lat])
  const segLen = turf.distance(a, b, { units: 'nauticalmiles' })
  if (segLen < 0.001) return 0
  const distFromA = turf.distance(a, turf.point(nearestCoords), { units: 'nauticalmiles' })
  return Math.max(0, Math.min(1, distFromA / segLen))
}

/** FAF data for precision GS altitude projection. */
interface GsInfo {
  fafWptIdx: number
  fafLat: number
  fafLon: number
  fafAlt: number
}

/**
 * Locate the GS FAF waypoint for ILS approaches.  Returns null for all other
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

export interface DetectionResult {
  detected: Record<string, boolean>
  lastSeen: Record<string, number>
  /** Hex codes of aircraft that matched each approach procedure. */
  detectedHexes: Record<string, string[]>
  /** Per-approach, per-hex minimum cross-track distance (nm). Used for parallel-runway dedup. */
  crossTrackNm: Record<string, Record<string, number>>
}

export function detectProceduresInUse(
  aircraft: InterpolatedAircraft[],
  procedures: Procedure[],
  airportLat: number,
  airportLon: number,
  airportElevationFt: number,
  nowMs: number,
): DetectionResult {
  const detected: Record<string, boolean> = {}
  const lastSeen: Record<string, number> = {}
  const detectedHexes: Record<string, string[]> = {}
  const crossTrackNm: Record<string, Record<string, number>> = {}

  const airportPt = turf.point([airportLon, airportLat])

  for (const proc of procedures) {
    if (!proc.hasGeometry || proc.waypoints.length < 2) {
      detected[proc.id] = false
      continue
    }

    const coords = proc.waypoints.map((w) => [w.lon, w.lat] as [number, number])
    const line = turf.lineString(coords)
    const xtThreshold = proc.type === 'APPROACH' ? CROSS_TRACK_APPROACH_NM : CROSS_TRACK_THRESHOLD_NM
    // Precompute GS info once per approach (null for SID/STAR and non-GS approaches)
    const gsInfo = findGsInfo(proc)

    let hit = false

    for (const ac of aircraft) {
      if (ac.altBaro === 'ground') continue
      const altFt = ac.altBaro as number
      const acPt = turf.point([ac.interpLon, ac.interpLat])

      const nearest = turf.nearestPointOnLine(line, acPt, { units: 'nauticalmiles' })
      const crossTrack = nearest.properties.dist ?? Infinity
      if (crossTrack > xtThreshold) continue

      const distToAirport = turf.distance(acPt, airportPt, { units: 'nauticalmiles' })
      const fallbackThreshold =
        distToAirport <= NEAR_AIRPORT_DISTANCE_NM ? ALT_THRESHOLD_NEAR_FT : ALT_THRESHOLD_FAR_FT

      const segIdx = nearest.properties.index ?? 0
      const wptBefore = proc.waypoints[segIdx]
      const wptAfter = proc.waypoints[Math.min(segIdx + 1, proc.waypoints.length - 1)]

      // Direction check: procedure waypoints are ordered in direction of flight.
      if (wptBefore !== wptAfter && (wptBefore.lat !== wptAfter.lat || wptBefore.lon !== wptAfter.lon)) {
        const segBearing = turf.bearing(
          turf.point([wptBefore.lon, wptBefore.lat]),
          turf.point([wptAfter.lon, wptAfter.lat]),
        )
        if (bearingDelta(ac.track, segBearing) > DIRECTION_TOLERANCE_DEG) continue
      }

      // ── Altitude check ──────────────────────────────────────────────────────
      let expectedAlt: number | null = null
      let tight = false // use ALT_THRESHOLD_CONSTRAINED_FT instead of fallback

      if (gsInfo !== null && segIdx >= gsInfo.fafWptIdx) {
        // On or past the FAF on a precision approach: project using 3° GS slope.
        const fafPt = turf.point([gsInfo.fafLon, gsInfo.fafLat])
        const distFromFafNm = turf.distance(acPt, fafPt, { units: 'nauticalmiles' })
        expectedAlt = gsInfo.fafAlt - distFromFafNm * GS_FEET_PER_NM
        tight = true
      } else {
        // Linear interpolation between the two bracketing waypoints.
        const frac = segmentFraction(wptBefore, wptAfter, nearest.geometry.coordinates as [number, number])
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
        altOk = altitudePlausibleForType(proc.type, altFt - airportElevationFt)
      } else {
        const threshold = tight ? ALT_THRESHOLD_CONSTRAINED_FT : fallbackThreshold
        altOk = Math.abs(altFt - expectedAlt) <= threshold
      }

      if (altOk) {
        if (!hit) { hit = true; lastSeen[proc.id] = nowMs }
        if (proc.type === 'APPROACH') {
          detectedHexes[proc.id] = detectedHexes[proc.id] ?? []
          detectedHexes[proc.id].push(ac.hex)
          if (!crossTrackNm[proc.id]) crossTrackNm[proc.id] = {}
          // Keep the minimum cross-track if the same hex somehow appears twice.
          const prev = crossTrackNm[proc.id][ac.hex] ?? Infinity
          crossTrackNm[proc.id][ac.hex] = Math.min(prev, crossTrack)
        } else {
          break
        }
      }
    }

    detected[proc.id] = hit
  }

  return { detected, lastSeen, detectedHexes, crossTrackNm }
}
