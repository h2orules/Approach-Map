import * as turf from '@turf/turf'

const NM = { units: 'nauticalmiles' as const }

const norm360 = (d: number): number => ((d % 360) + 360) % 360

/** Smallest absolute angular difference between two bearings, 0–180°. */
export function bearingDelta(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

/** Zero-pad a 1–360 course to three digits ("005", "042", "342", "360"). */
export function padCourse(deg: number): string {
  let v = Math.round(norm360(deg))
  if (v === 0) v = 360
  return String(v).padStart(3, '0')
}

/** Minimal leg shape needed to derive segment course labels. */
export interface CourseLeg {
  lat: number
  lon: number
  /** ARINC magnetic course TO this fix (chart value), 0 = none. */
  course: number
  /** ARINC path terminator (TF/CF/RF/PI/HM/...). */
  pathTerm: string
  /** Waypoint role; used to stop labeling at the missed-approach point. */
  role: string
}

export interface CourseLabel {
  lat: number
  lon: number
  /** Geodetic bearing of the group (for on-screen rotation). */
  trueBearing: number
  /** Zero-padded magnetic course, no degree sign or NoPT suffix. */
  text: string
  /** True when this leg's transition is a NoPT route (append "NoPT"). */
  noPt: boolean
}

// Course reversals / holds / DME arcs render as their own shapes, not straight
// segments — a chord course label on a curved arc (AF) would be misleading.
const SKIP_TERMS = new Set(['PI', 'HM', 'HF', 'HA', 'AF'])

/**
 * Group a transition's straight legs into FAA-style magnetic course labels.
 * Walks legs up to and including the missed-approach point (`role === 'map'`),
 * skipping course-reversal/hold legs, then merges consecutive segments whose
 * geodetic bearings agree within `groupToleranceDeg` into a single label
 * anchored at the middle segment's midpoint. Label course prefers the ARINC
 * magnetic `course` of the destination leg; falls back to the geodetic bearing
 * corrected by `magVarDeg` (true = mag + magVarE) when it is absent.
 */
export function groupCourseLabels(
  legs: CourseLeg[],
  magVarDeg: number,
  noPt: boolean,
  opts?: { minSegNm?: number; groupToleranceDeg?: number },
): CourseLabel[] {
  const minSeg = opts?.minSegNm ?? 0.3
  const tol = opts?.groupToleranceDeg ?? 3

  // Vertices up to (and including) the MAP, minus course-reversal/hold legs.
  const kept: CourseLeg[] = []
  for (const l of legs) {
    if (!SKIP_TERMS.has(l.pathTerm)) kept.push(l)
    if (l.role === 'map') break
  }

  interface Seg { a: CourseLeg; b: CourseLeg; bearing: number }
  const segs: Seg[] = []
  for (let i = 0; i < kept.length - 1; i++) {
    const a = kept[i]
    const b = kept[i + 1]
    const pa = turf.point([a.lon, a.lat])
    const pb = turf.point([b.lon, b.lat])
    if (turf.distance(pa, pb, NM) < minSeg) continue
    segs.push({ a, b, bearing: turf.bearing(pa, pb) })
  }

  const labels: CourseLabel[] = []
  let group: Seg[] = []
  const flush = () => {
    if (group.length === 0) return
    const mid = group[Math.floor((group.length - 1) / 2)]
    const midPt = turf.midpoint(turf.point([mid.a.lon, mid.a.lat]), turf.point([mid.b.lon, mid.b.lat]))
    const [lon, lat] = midPt.geometry.coordinates
    const mag = mid.b.course > 0 ? mid.b.course : norm360(mid.bearing - magVarDeg)
    labels.push({ lat, lon, trueBearing: mid.bearing, text: padCourse(mag), noPt })
    group = []
  }
  for (const s of segs) {
    if (group.length > 0 && bearingDelta(s.bearing, group[0].bearing) > tol) flush()
    group.push(s)
  }
  flush()
  return labels
}

/**
 * Screen rotation (deg, CSS clockwise) for a text label aligned with a leg of
 * geodetic bearing `trueBearing` on a map rotated by `mapBearingDeg`. Text runs
 * left→right along the leg. `flipped` is true when the label was rotated 180°
 * to stay upright (readable) — callers should mirror which side of the line the
 * label sits on so "above" stays visually above.
 */
export function labelRotation(
  trueBearing: number,
  mapBearingDeg: number,
): { rot: number; flipped: boolean } {
  const norm = (d: number) => (((d + 180) % 360) + 360) % 360 - 180
  let rot = norm(trueBearing - mapBearingDeg - 90)
  let flipped = false
  if (Math.abs(rot) > 90) {
    rot = norm(rot + 180)
    flipped = true
  }
  return { rot, flipped }
}
