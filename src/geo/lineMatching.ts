import * as turf from '@turf/turf'

/** Smallest absolute angle (deg, 0–180) between two bearings. */
export function bearingDelta(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

export interface LineMatchOptions {
  maxCrossTrackNm: number
  directionToleranceDeg: number
  /**
   * Reject a match whose nearest segment is zero-length (duplicate consecutive
   * coords) instead of accepting it with the direction gate skipped. Detection
   * accepts them (a restriction leg on the same fix is still evidence); the
   * flown/active-segment renderers reject them (a zero-length highlight is
   * useless and would bypass the reciprocal-direction check).
   */
  rejectZeroLength?: boolean
}

export interface LineMatch {
  crossTrackNm: number
  segIdx: number
  segStart: [number, number]
  segEnd: [number, number]
  segBearing: number
  nearestCoords: [number, number]
  /** Distance (nm) from the line's start to the nearest point — the aircraft's
   *  along-track position. Lets the detection machine require net progress. */
  alongTrackNm: number
}

/**
 * Nearest-point-on-line match with a direction gate. Returns null when the
 * aircraft is farther than `maxCrossTrackNm` from the line, or when its track
 * differs from the local segment bearing by more than `directionToleranceDeg`.
 *
 * `coords` are ordered in the direction of flight (waypoint sequence). A
 * zero-length segment (duplicate consecutive coords) has no defined bearing, so
 * the direction gate is skipped for it — matching prior behavior.
 */
export function matchPointToLine(
  coords: [number, number][],
  lat: number,
  lon: number,
  track: number,
  opts: LineMatchOptions,
): LineMatch | null {
  if (coords.length < 2) return null

  const line = turf.lineString(coords)
  const acPt = turf.point([lon, lat])
  const nearest = turf.nearestPointOnLine(line, acPt, { units: 'nauticalmiles' })
  const crossTrackNm = nearest.properties.dist ?? Infinity
  if (crossTrackNm > opts.maxCrossTrackNm) return null
  const alongTrackNm = nearest.properties.location ?? 0

  const segIdx = nearest.properties.index ?? 0
  const segStart = coords[segIdx]
  const segEnd = coords[Math.min(segIdx + 1, coords.length - 1)]
  const nearestCoords = nearest.geometry.coordinates as [number, number]

  // Zero-length segment carries no direction — skip the gate (or reject).
  const zeroLen = segStart === segEnd || (segStart[0] === segEnd[0] && segStart[1] === segEnd[1])
  if (zeroLen && opts.rejectZeroLength) return null
  const segBearing = zeroLen
    ? track
    : turf.bearing(turf.point(segStart), turf.point(segEnd))
  if (!zeroLen && bearingDelta(track, segBearing) > opts.directionToleranceDeg) return null

  return { crossTrackNm, segIdx, segStart, segEnd, segBearing, nearestCoords, alongTrackNm }
}

/**
 * Proper 0–1 fraction of a point along the segment [a, b].
 * turf.nearestPointOnLine `location` is total distance along the whole line
 * (nm), not a per-segment fraction — using it directly is a bug when the line
 * is longer than the segment. `nearestCoords` should lie on [a, b].
 */
export function segmentFraction(
  a: [number, number],
  b: [number, number],
  nearestCoords: [number, number],
): number {
  const pa = turf.point(a)
  const segLen = turf.distance(pa, turf.point(b), { units: 'nauticalmiles' })
  if (segLen < 0.001) return 0
  const distFromA = turf.distance(pa, turf.point(nearestCoords), { units: 'nauticalmiles' })
  return Math.max(0, Math.min(1, distFromA / segLen))
}
