import * as turf from '@turf/turf'
import type { Position } from 'geojson'
import { LOC_FEATHER_NOTCH_NM } from '../config/constants'

export interface LocFeather {
  /** Filled half of the feather (one ring per polygon; currently a single triangle). */
  shaded: Position[][]
  /** Full feather perimeter (apex, far corners, swallow-tail notch), one closed ring. */
  outline: Position[]
}

const NM = { units: 'nauticalmiles' as const }

/**
 * Builds the FAA-plate-style localizer "feather" symbol: an elongated
 * triangle with its apex AT the runway threshold, widening outbound
 * (opposite the inbound approach course) to `widthNm`, with a swallow-tail
 * notch cut into the far edge back toward the apex along the centerline.
 *
 * Orientation follows `extendedCenterline.ts`: bearings are computed with
 * `turf.bearing`/`turf.destination` off the given true course, not the
 * (possibly magnetic) published runway heading.
 *
 * The "right side of the inbound course" (facing the direction of travel
 * toward the threshold, i.e. `inboundCourseTrueDeg`) is shaded, matching the
 * typical plan-view plate depiction.
 */
export function buildLocFeather(
  thresholdLat: number,
  thresholdLon: number,
  inboundCourseTrueDeg: number,
  lengthNm: number,
  widthNm: number,
): LocFeather {
  const apex: Position = [thresholdLon, thresholdLat]
  const apexPt = turf.point(apex)

  const outboundBearing = (inboundCourseTrueDeg + 180) % 360
  const rightBearing = (inboundCourseTrueDeg + 90) % 360
  const leftBearing = (inboundCourseTrueDeg + 270) % 360

  const farCenterPt = turf.destination(apexPt, lengthNm, outboundBearing, NM)
  const notchPt = turf.destination(apexPt, lengthNm - LOC_FEATHER_NOTCH_NM, outboundBearing, NM)
  const farRightPt = turf.destination(farCenterPt, widthNm / 2, rightBearing, NM)
  const farLeftPt = turf.destination(farCenterPt, widthNm / 2, leftBearing, NM)

  const farRight = farRightPt.geometry.coordinates as Position
  const farLeft = farLeftPt.geometry.coordinates as Position
  const notch = notchPt.geometry.coordinates as Position

  const outline: Position[] = [apex, farLeft, notch, farRight, apex]
  const shaded: Position[][] = [[apex, farRight, notch, apex]]

  return { shaded, outline }
}
