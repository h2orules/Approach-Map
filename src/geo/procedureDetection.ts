import * as turf from '@turf/turf'
import type { InterpolatedAircraft } from '../types/aircraft'
import type { Procedure, ProcedureType, ProcedureWaypoint } from '../types/procedure'
import { resolveAltConstraint } from '../utils/altitudeConstraint'
import {
  CROSS_TRACK_THRESHOLD_NM,
  ALT_THRESHOLD_NEAR_FT,
  ALT_THRESHOLD_FAR_FT,
  NEAR_AIRPORT_DISTANCE_NM,
  DIRECTION_TOLERANCE_DEG,
} from '../config/constants'

/** Smallest absolute angle between two bearings, 0–180°. */
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

function interpolateExpectedAlt(
  wptBefore: ProcedureWaypoint,
  wptAfter: ProcedureWaypoint,
  fraction: number,
): number | null {
  const altBefore = resolveAltConstraint(wptBefore.altConstraint)
  const altAfter = resolveAltConstraint(wptAfter.altConstraint)
  if (altBefore === null && altAfter === null) return null
  if (altBefore === null) return altAfter
  if (altAfter === null) return altBefore
  return altBefore + (altAfter - altBefore) * fraction
}

export interface DetectionResult {
  detected: Record<string, boolean>
  lastSeen: Record<string, number>
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

  const airportPt = turf.point([airportLon, airportLat])

  for (const proc of procedures) {
    if (!proc.hasGeometry || proc.waypoints.length < 2) {
      detected[proc.id] = false
      continue
    }

    const coords = proc.waypoints.map((w) => [w.lon, w.lat] as [number, number])
    const line = turf.lineString(coords)
    let hit = false

    for (const ac of aircraft) {
      if (ac.altBaro === 'ground') continue
      const altFt = ac.altBaro as number
      const acPt = turf.point([ac.interpLon, ac.interpLat])

      const nearest = turf.nearestPointOnLine(line, acPt, { units: 'nauticalmiles' })
      const crossTrackNm = nearest.properties.dist ?? Infinity
      if (crossTrackNm > CROSS_TRACK_THRESHOLD_NM) continue

      const distToAirport = turf.distance(acPt, airportPt, { units: 'nauticalmiles' })
      const altThreshold = distToAirport <= NEAR_AIRPORT_DISTANCE_NM
        ? ALT_THRESHOLD_NEAR_FT
        : ALT_THRESHOLD_FAR_FT

      const segIdx = nearest.properties.index ?? 0
      const wptBefore = proc.waypoints[segIdx]
      const wptAfter = proc.waypoints[Math.min(segIdx + 1, proc.waypoints.length - 1)]
      const fraction = nearest.properties.location ?? 0

      // Direction check: procedure waypoints are ordered in the direction of
      // flight, so the local segment bearing is the expected ground track. An
      // aircraft flying the reciprocal (e.g. landing rwy 16 while sitting on the
      // rwy 34 approach's shared centerline) must not match.
      if (wptBefore !== wptAfter && (wptBefore.lat !== wptAfter.lat || wptBefore.lon !== wptAfter.lon)) {
        const segBearing = turf.bearing(
          turf.point([wptBefore.lon, wptBefore.lat]),
          turf.point([wptAfter.lon, wptAfter.lat]),
        )
        if (bearingDelta(ac.track, segBearing) > DIRECTION_TOLERANCE_DEG) continue
      }

      const expectedAlt = interpolateExpectedAlt(wptBefore, wptAfter, fraction)

      let altOk: boolean
      if (expectedAlt === null) {
        const agl = altFt - airportElevationFt
        altOk = altitudePlausibleForType(proc.type, agl)
      } else {
        altOk = Math.abs(altFt - expectedAlt) <= altThreshold
      }

      if (altOk) {
        hit = true
        lastSeen[proc.id] = nowMs
        break
      }
    }

    detected[proc.id] = hit
  }

  return { detected, lastSeen }
}
