import * as turf from '@turf/turf'

type Pt = [number, number]

const NM = { units: 'nauticalmiles' as const }

function dest(p: Pt, distNm: number, bearing: number): Pt {
  return turf.destination(turf.point(p), distNm, bearing, NM).geometry.coordinates as Pt
}

/** Sweep an arc of `points` around `center`, from `startBrg` to `startBrg ± 180`. */
function semicircle(center: Pt, radiusNm: number, startBrg: number, right: boolean, steps = 16): Pt[] {
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
export function holdTrack(
  fixLat: number,
  fixLon: number,
  inboundCourse: number,
  right: boolean,
  legNm: number,
): Pt[] {
  const F: Pt = [fixLon, fixLat]
  const L = Math.min(Math.max(legNm || 0, 1.5), 6)
  const r = 0.85
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
 * Simplified procedure-turn barb: the outbound leg plus a 45° barb on the
 * maneuvering side — enough to read direction and side on the map.
 */
export function procedureTurn(
  fixLat: number,
  fixLon: number,
  outboundCourse: number,
  right: boolean,
  distNm: number,
): Pt[] {
  const F: Pt = [fixLon, fixLat]
  const L = Math.min(Math.max(distNm || 0, 2), 5)
  const end = dest(F, L, outboundCourse)
  const barbBrg = (outboundCourse + (right ? 45 : -45) + 360) % 360
  const barb = dest(end, 1.4, barbBrg)
  const reversal = dest(end, 1.4, (barbBrg + 180) % 360)
  return [F, end, barb, end, reversal]
}
