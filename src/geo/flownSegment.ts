import * as turf from '@turf/turf'
import type { Feature, LineString } from 'geojson'
import type { Procedure } from '../types/procedure'
import { DIRECTION_TOLERANCE_DEG } from '../config/constants'

// How close (lateral) an aircraft must be to a procedure leg for that leg to be
// shown as the one being flown.
const MAX_OFFSET_NM = 2

function bearingDelta(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

export interface FlownSegmentMatch {
  /** Which procedure the winning segment belongs to. */
  procedure: Procedure
  segment: Feature<LineString>
}

/**
 * Find the single procedure leg (segment between two fixes) the aircraft is
 * currently flying — the nearest qualifying segment across all given
 * procedures, matched on both proximity and direction (so the reciprocal leg
 * on a shared centerline isn't picked). Also identifies which procedure the
 * winning segment belongs to (consumers that only need the line for drawing
 * should use `findFlownSegment` below; this is for callers that need the
 * procedure identity too, e.g. resolving which approach to show a vertical
 * profile for).
 */
export function findFlownSegmentMatch(
  lat: number,
  lon: number,
  track: number,
  procedures: Procedure[],
): FlownSegmentMatch | null {
  const acPt = turf.point([lon, lat])
  let best: { coords: [number, number][]; dist: number; procedure: Procedure } | null = null

  for (const proc of procedures) {
    for (const feat of proc.geojson.features) {
      if (feat.geometry?.type !== 'LineString') continue
      const coords = feat.geometry.coordinates as [number, number][]
      if (coords.length < 2) continue

      const line = turf.lineString(coords)
      const nearest = turf.nearestPointOnLine(line, acPt, { units: 'nauticalmiles' })
      const dist = nearest.properties.dist ?? Infinity
      if (dist > MAX_OFFSET_NM) continue

      const i = nearest.properties.index ?? 0
      const a = coords[i]
      const b = coords[Math.min(i + 1, coords.length - 1)]
      if (!a || !b || (a[0] === b[0] && a[1] === b[1])) continue

      const segBearing = turf.bearing(turf.point(a), turf.point(b))
      if (bearingDelta(track, segBearing) > DIRECTION_TOLERANCE_DEG) continue

      if (!best || dist < best.dist) best = { coords: [a, b], dist, procedure: proc }
    }
  }

  if (!best) return null
  return {
    procedure: best.procedure,
    segment: turf.lineString(best.coords) as Feature<LineString>,
  }
}

/**
 * Find the single procedure leg (segment between two fixes) the aircraft is
 * currently flying. See `findFlownSegmentMatch` for the matching rules; this
 * is the draw-only convenience wrapper used by `FlownSegmentLayer`.
 */
export function findFlownSegment(
  lat: number,
  lon: number,
  track: number,
  procedures: Procedure[],
): Feature<LineString> | null {
  return findFlownSegmentMatch(lat, lon, track, procedures)?.segment ?? null
}
