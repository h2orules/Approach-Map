import * as turf from '@turf/turf'
import type { Feature, LineString } from 'geojson'
import type { RunwayEnd } from '../types/airport'

export interface CenterlineFeature {
  runwayId: string
  line: Feature<LineString>
}

/**
 * Build the extended centerline for one runway end, projecting in the
 * inbound approach direction. Uses turf.bearing() on the actual threshold
 * coordinates to get the true geodetic bearing — avoids the need to know
 * whether the stored heading is magnetic or true, and avoids any
 * Mercator/flat-Earth approximation errors for long lines.
 */
export function buildExtendedCenterline(
  end: RunwayEnd,
  otherEnd: RunwayEnd,
  lengthNm: number,
): CenterlineFeature {
  const origin = turf.point([end.lon, end.lat])
  const other = turf.point([otherEnd.lon, otherEnd.lat])

  // True bearing FROM this threshold TOWARD the far threshold = runway axis direction
  const runwayAxisBearing = turf.bearing(origin, other)
  // Reciprocal = the inbound approach bearing (aircraft approaches FROM outside, TOWARD this threshold)
  const approachBearing = (runwayAxisBearing + 180 + 360) % 360

  const dest = turf.destination(origin, lengthNm, approachBearing, { units: 'nauticalmiles' })

  const line = turf.lineString([
    [end.lon, end.lat],
    dest.geometry.coordinates,
  ]) as Feature<LineString>

  return { runwayId: end.id, line }
}
