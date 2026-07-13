import * as turf from '@turf/turf'

type Pt = [number, number]

const NM = { units: 'nauticalmiles' as const }

export function dest(p: Pt, distNm: number, bearing: number): Pt {
  return turf.destination(turf.point(p), distNm, bearing, NM).geometry.coordinates as Pt
}

/**
 * A DME arc (ARINC 424 "AF" leg) as a polyline: the curved path at a roughly
 * constant DME radius around `center`, from the start fix to the end fix, swept
 * in the leg's turn direction (`right` = clockwise / increasing bearing from
 * the station). The radius is interpolated between the two endpoints' actual
 * measured distances, so the drawn arc meets both fixes exactly even when they
 * sit a touch off the nominal radius. Returns `[start, …, end]` in [lon, lat]
 * order. Falls back to a straight [start, end] when the sweep is degenerate.
 */
export function dmeArc(
  centerLat: number,
  centerLon: number,
  startLat: number,
  startLon: number,
  endLat: number,
  endLon: number,
  right: boolean,
): Pt[] {
  const C: Pt = [centerLon, centerLat]
  const S: Pt = [startLon, startLat]
  const E: Pt = [endLon, endLat]
  const cPt = turf.point(C)
  const rS = turf.distance(cPt, turf.point(S), NM)
  const rE = turf.distance(cPt, turf.point(E), NM)
  const bS = turf.bearing(cPt, turf.point(S))
  const bE = turf.bearing(cPt, turf.point(E))
  const n360 = (d: number): number => ((d % 360) + 360) % 360
  // Right turn sweeps to increasing bearing, left to decreasing; either way the
  // magnitude is the short way from the start radial to the end radial.
  const sweep = right ? n360(bE - bS) : -n360(bS - bE)
  if (Math.abs(sweep) < 0.5) return [S, E]
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / 4)) // ≤4° per segment
  const out: Pt[] = []
  for (let k = 0; k <= steps; k++) {
    const t = k / steps
    out.push(dest(C, rS + (rE - rS) * t, bS + sweep * t))
  }
  return out
}

/** Sweep an arc of `points` around `center`, from `startBrg` to `startBrg ± 180`. */
export function semicircle(center: Pt, radiusNm: number, startBrg: number, right: boolean, steps = 16): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i <= steps; i++) {
    const f = i / steps
    const brg = startBrg + (right ? 180 : -180) * f
    out.push(dest(center, radiusNm, brg))
  }
  return out
}

/**
 * Holding-pattern racetrack as a closed line.
 * `inboundCourse` is the magnetic/true course flown TOWARD the fix; `right`
 * selects standard (right) vs non-standard turns; `legNm` is the straight-leg
 * length. Geometry is approximate — sized for legibility, not navigation.
 */
// Hold racetrack sizing (shared by holdTrack and holdOutboundLabelAnchor so the
// label lands exactly on the drawn outbound leg).
export const HOLD_TURN_R = 0.85 // nm — turn radius / half the track width
export const clampHoldLeg = (legNm: number): number => Math.min(Math.max(legNm || 0, 1.5), 6)

export function holdTrack(
  fixLat: number,
  fixLon: number,
  inboundCourse: number,
  right: boolean,
  legNm: number,
): Pt[] {
  const F: Pt = [fixLon, fixLat]
  const L = clampHoldLeg(legNm)
  const r = HOLD_TURN_R
  const recip = (inboundCourse + 180) % 360
  const side = (inboundCourse + (right ? 90 : -90) + 360) % 360

  const A = dest(F, L, recip) // start of inbound straight (behind the fix)
  const B = dest(F, 2 * r, side) // abeam fix on the outbound track
  const C = dest(A, 2 * r, side) // abeam A on the outbound track
  const center1 = dest(F, r, side) // turn at the fix end
  const center2 = dest(A, r, side) // turn at the far end

  return [
    A,
    F,
    ...semicircle(center1, r, (inboundCourse + (right ? 90 : -90) + 180) % 360, right),
    B,
    C,
    ...semicircle(center2, r, (recip + (right ? 90 : -90) + 180) % 360, right),
    A,
  ]
}

/**
 * Midpoint and travel-direction of a hold's OUTBOUND straight leg — the far side
 * (B→C) that `holdTrack` draws away from the inbound-to-fix line. Returns the leg
 * midpoint plus its geodetic (true) course, matching the same B/C geometry
 * holdTrack builds so a course label lands exactly on the drawn leg. The travel
 * direction along the outbound leg is the reciprocal of the inbound course.
 * `inboundCourse` is TRUE (convert from magnetic before calling).
 */
export function holdOutboundLabelAnchor(
  fixLat: number,
  fixLon: number,
  inboundCourse: number,
  right: boolean,
  legNm: number,
): { lat: number; lon: number; courseTrue: number } {
  const F: Pt = [fixLon, fixLat]
  const L = clampHoldLeg(legNm)
  const r = HOLD_TURN_R
  const recip = (inboundCourse + 180) % 360
  const side = (inboundCourse + (right ? 90 : -90) + 360) % 360
  const A = dest(F, L, recip)
  const B = dest(F, 2 * r, side) // abeam fix on the outbound track
  const C = dest(A, 2 * r, side) // abeam A on the outbound track
  return { lon: (B[0] + C[0]) / 2, lat: (B[1] + C[1]) / 2, courseTrue: recip }
}

/**
 * Midpoint and travel-direction of a hold's INBOUND straight leg — the A→F
 * segment holdTrack draws arriving at the fix. Pilots expect the inbound course
 * labeled on the racetrack even when it coincides with the final approach
 * course (plates always print both hold courses). `inboundCourse` is TRUE.
 */
export function holdInboundLabelAnchor(
  fixLat: number,
  fixLon: number,
  inboundCourse: number,
  legNm: number,
): { lat: number; lon: number; courseTrue: number } {
  const F: Pt = [fixLon, fixLat]
  const L = clampHoldLeg(legNm)
  const recip = (inboundCourse + 180) % 360
  const A = dest(F, L, recip)
  return { lon: (A[0] + F[0]) / 2, lat: (A[1] + F[1]) / 2, courseTrue: inboundCourse }
}

/** Length (nm) of the outbound PT leg actually drawn, clamped 2–5 nm from the
 *  published "remain within" limit. Exported so label placement can find the
 *  midpoint of the same leg the shape draws. */
export function procedureTurnDrawnLengthNm(limitNm: number): number {
  return Math.min(Math.max(limitNm || 0, 2), 5)
}

/** Length (nm) of the 45° barb tick. */
export const PT_BARB_NM = 1.3
/** Length (nm) of the half-arrowhead drawn at the outer end of the barb tick. */
const PT_ARROW_NM = 0.45

/**
 * FAA-chart procedure-turn barb: a straight outbound leg from the fix, then a
 * SINGLE 45° barb tick on the maneuvering side at the leg's end (no crossbar),
 * capped with a half-arrowhead pointing outward along the tick. The barb turns
 * 45° toward the reversal side — +45° from the outbound course for a LEFT turn,
 * −45° for a RIGHT turn. `outboundCourse` is TRUE. Returns the polyline
 * [fix, outboundEnd, barbTip, arrowWing]: fix→end is the outbound leg, end→tip
 * the 45° tick, tip→wing the half arrow.
 */
export function procedureTurn(
  fixLat: number,
  fixLon: number,
  outboundCourse: number,
  right: boolean,
  distNm: number,
): Pt[] {
  const F: Pt = [fixLon, fixLat]
  const L = procedureTurnDrawnLengthNm(distNm)
  const end = dest(F, L, outboundCourse)
  const barbBrg = (outboundCourse + (right ? -45 : 45) + 360) % 360
  const tip = dest(end, PT_BARB_NM, barbBrg)
  // Half arrowhead at the tip: a single wing swept back toward the leg, on the
  // maneuvering (turn) side so it reads as an arrow pointing down the barb.
  const wingBrg = (barbBrg + 180 + (right ? 35 : -35) + 360) % 360
  const wing = dest(tip, PT_ARROW_NM, wingBrg)
  return [F, end, tip, wing]
}
