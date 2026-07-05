import * as turf from '@turf/turf'
import type { Feature, LineString } from 'geojson'
import type { Procedure } from '../types/procedure'
import { DIRECTION_TOLERANCE_DEG } from '../config/constants'
import { matchPointToLine } from './lineMatching'

// How close (lateral) an aircraft must be to a procedure leg for that leg to be
// shown as the one being flown.
const MAX_OFFSET_NM = 2

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
  let best: { coords: [[number, number], [number, number]]; dist: number; procedure: Procedure } | null =
    null

  for (const proc of procedures) {
    for (const feat of proc.geojson.features) {
      if (feat.geometry?.type !== 'LineString') continue
      const coords = feat.geometry.coordinates as [number, number][]
      const match = matchPointToLine(coords, lat, lon, track, {
        maxCrossTrackNm: MAX_OFFSET_NM,
        directionToleranceDeg: DIRECTION_TOLERANCE_DEG,
        rejectZeroLength: true,
      })
      if (!match) continue
      if (!best || match.crossTrackNm < best.dist) {
        best = { coords: [match.segStart, match.segEnd], dist: match.crossTrackNm, procedure: proc }
      }
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
