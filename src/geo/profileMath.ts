import * as turf from '@turf/turf'
import type { AltConstraint, Procedure, ProcedureLeg, ProcedureTransition, WaypointRole } from '../types/procedure'
import type { CifpRunwayInfo } from '../types/cifp'
import { resolveAltConstraint } from '../utils/altitudeConstraint'
import { FEET_PER_NM } from '../config/constants'

const NM = { units: 'nauticalmiles' as const }

// Consecutive legs closer together than this are treated as the "same fix" —
// a common ARINC 424 pattern where an altitude/speed restriction rides on a
// second leg record at the same point as the course leg.
const SAME_FIX_EPS_NM = 0.02

const ROLE_RANK: Record<WaypointRole, number> = { map: 6, faf: 5, iaf: 4, if: 3, hold: 2, normal: 1 }

const HOLD_PATH_TERMS = new Set(['HM', 'HF', 'HA', 'PI'])

/** A live aircraft's position on the profile (see ProfilePanel/ProfileSvg). */
export interface LiveAircraft {
  hex: string
  distNm: number
  altFt: number
  label: string
  /** Whether this is the currently-selected aircraft (drawn in accent styling; others are dimmed). */
  isSelected: boolean
}

export interface ProfileFix {
  fixId: string
  distNm: number
  constraint: AltConstraint | null
  plotAltFt: number | null
  role: WaypointRole
  pathTerm: string
  speedKt: number
  isGsIntercept: boolean
  isDmeArc: boolean
  dmeNm: number | null
  /** Ident of the DME's source navaid (e.g. 'I-CJL'), null if dmeNm is null or the leg carried no recNavId. */
  dmeNavaidId: string | null
  flyover: boolean
  /** Marker-beacon type when this fix is a marker (OM/MM/IM), else null. */
  marker: 'OM' | 'MM' | 'IM' | null
  /** True when the marker is a locator (LOM) — drives the NDB-style rendering. */
  markerLocator: boolean
}

export interface ProfileHold {
  atFixIdx: number
  inMissed: boolean
  kind: 'HM' | 'HF' | 'HA' | 'PI'
}

/**
 * A charted course reversal (procedure turn) rendered as an excursion to the
 * left of an anchor fix on the profile. Domain-level (altitudes + which fix it
 * hangs off of); the pixel geometry of the barb is left to ProfileSvg.
 */
export interface ProfileCourseReversal {
  /** Index into ProfileModel.fixes of the fix the reversal hangs off of. */
  anchorFixIdx: number
  /** True when we anchored at the FAF because the reversal's own fix isn't a
   *  profile fix (a collocated IAF, e.g. the AW NDB at KAWO WATON) — the anchor
   *  is then also tagged IAF, since the turn is entered there. */
  anchorIsIaf: boolean
  /** Arrival (entry) altitude constraint, drawn at the top of the excursion. */
  entryConstraint: AltConstraint | null
  entryAltFt: number | null
  /** PT-completion altitude constraint, drawn at the left vertex. */
  vertexConstraint: AltConstraint | null
  vertexAltFt: number | null
  /** Outbound / inbound magnetic courses (chart display values). */
  outboundCourse: number
  inboundCourse: number
  turnRight: boolean
  /** "Remain within N NM" excursion limit. */
  limitNm: number
}

/**
 * A hold-in-lieu-of-PT (HILPT) rendered as the FAA-plate horizontal racetrack
 * segment hanging off an anchor fix: an outbound line (away from the runway)
 * over an inbound line (toward it), courses labeled, with the hold's own
 * altitude constraint. Domain-level; pixel geometry is left to ProfileSvg.
 */
export interface ProfileHoldInLieu {
  /** Index into ProfileModel.fixes of the fix the hold hangs off of. */
  anchorFixIdx: number
  /** Inbound / outbound magnetic courses (chart display values). */
  inboundCourse: number
  outboundCourse: number
  /** The HF leg's own crossing constraint (e.g. ≥2000 at KAWO SAVOY). */
  alt: AltConstraint | null
  altFt: number | null
  /** Straight-leg length, nm (drives the "N NM Holding Pattern" note). */
  legNm: number
}

export interface ProfileModel {
  procedureId: string
  name: string
  fixes: ProfileFix[]
  missed: ProfileFix[]
  gsAngleDeg: number
  usedFallbackGs: boolean
  tchFt: number | null
  tdzeFt: number | null
  runwayLengthFt: number | null
  totalNm: number
  holds: ProfileHold[]
  /** Final approach course (magnetic), from the MAP leg; null when unknown. */
  appCourseMag: number | null
  /**
   * True only when the approach has genuinely charted vertical guidance
   * (RNAV path point or ILS glide slope). Gates the 34:1 clear-surface wedge —
   * a coded VDA / 3° fallback does NOT earn one.
   */
  hasChartedVerticalGuidance: boolean
  /** Course-reversal excursion to render, or null. */
  courseReversal: ProfileCourseReversal | null
  /** Hold-in-lieu-of-PT racetrack segment to render, or null. */
  holdInLieu: ProfileHoldInLieu | null
}

/**
 * Pick the transition that carries the procedure's final/common segment — the
 * one whose legs include both a FAF and the MAP. Falls back to the transition
 * with the most legs when no transition has both roles, and to null when the
 * procedure has no parsed transitions at all.
 */
export function pickProfileTransition(p: Procedure): ProcedureTransition | null {
  const transitions = p.transitions
  if (!transitions || transitions.length === 0) return null

  const withFafAndMap = transitions.filter(
    (t) => t.legs.some((l) => l.role === 'faf') && t.legs.some((l) => l.role === 'map'),
  )
  const pool = withFafAndMap.length > 0 ? withFafAndMap : transitions

  let best = pool[0]
  for (let i = 1; i < pool.length; i++) {
    if (pool[i].legs.length > best.legs.length) best = pool[i]
  }
  return best
}

function isPrecisionProcedure(p: Procedure): boolean {
  if (p.gpaDeg != null) return true
  return p.name.trim().toUpperCase().startsWith('I')
}

interface MergedGroup {
  fixId: string
  role: WaypointRole
  pathTerm: string
  constraint: AltConstraint | null
  speedKt: number
  dmeNm: number | null
  dmeNavaidId: string | null
  flyover: boolean
  isDmeArc: boolean
}

/** Collapse consecutive legs at the same point, keeping the strongest data. */
function mergeGroup(legs: ProcedureLeg[]): MergedGroup {
  let role: WaypointRole = 'normal'
  let pathTerm = legs[legs.length - 1].pathTerm
  let constraint: AltConstraint | null = null
  let speedKt = 0
  let dmeNm: number | null = null
  let dmeNavaidId: string | null = null
  let flyover = false
  let isDmeArc = false

  for (const leg of legs) {
    if (ROLE_RANK[leg.role] > ROLE_RANK[role]) {
      role = leg.role
      pathTerm = leg.pathTerm
    }
    if (leg.altConstraint) constraint = leg.altConstraint
    if (leg.speedKt > speedKt) speedKt = leg.speedKt
    if (dmeNm == null && leg.dmeNm != null) {
      dmeNm = leg.dmeNm
      dmeNavaidId = leg.recNavId || null
    }
    if (leg.flyover) flyover = true
    if (leg.pathTerm === 'AF') isDmeArc = true
  }

  return { fixId: legs[0].fixId, role, pathTerm, constraint, speedKt, dmeNm, dmeNavaidId, flyover, isDmeArc }
}

/** Final approach course (magnetic): the MAP leg's course, else the leg after
 *  the FAF, else null. */
function approachCourseMag(legs: ProcedureLeg[]): number | null {
  const mapLeg = legs.find((l) => l.role === 'map')
  if (mapLeg) return mapLeg.course
  const fafIdx = legs.findIndex((l) => l.role === 'faf')
  if (fafIdx !== -1 && fafIdx + 1 < legs.length) return legs[fafIdx + 1].course
  return null
}

/** Locate the fix a course reversal hangs off of: its own fix by id, else the
 *  FAF (the reversal fix is a collocated IAF that isn't a distinct profile fix). */
function resolveReversalAnchor(
  fixes: ProfileFix[],
  reversal: NonNullable<Procedure['courseReversal']>,
): { idx: number; viaFallback: boolean } | null {
  const byId = fixes.findIndex((f) => f.fixId === reversal.fixId)
  if (byId !== -1) return { idx: byId, viaFallback: false }
  const fafIdx = fixes.findIndex((f) => f.role === 'faf')
  if (fafIdx !== -1) return { idx: fafIdx, viaFallback: true }
  return null
}

/**
 * FAA charting rule for a course reversal: pre-anchor fixes whose plotted
 * altitude equals the PT-completion altitude add nothing to the vertical story
 * (they're flat at the same altitude the turn ends on) and are dropped, leaving
 * room to the left of the anchor for the excursion. Returns a keep-mask
 * (true = keep) the same length as `fixes`. Pre-anchor fixes with a DIFFERENT
 * (or absent) altitude are kept.
 */
export function ptKeepMask(fixes: ProfileFix[], reversal: Procedure['courseReversal'] | null | undefined): boolean[] {
  const keep = fixes.map(() => true)
  if (!reversal) return keep
  const anchor = resolveReversalAnchor(fixes, reversal)
  if (!anchor) return keep
  const ptAlt = resolveAltConstraint(reversal.alt)
  if (ptAlt == null) return keep
  for (let i = 0; i < anchor.idx; i++) {
    if (fixes[i].plotAltFt === ptAlt) keep[i] = false
  }
  return keep
}

/**
 * Build the ProfileCourseReversal for a (post-drop) fix list, or null when the
 * approach has no reversal / no anchor fix. Pure — the pixel barb is drawn by
 * ProfileSvg from these domain values.
 */
export function courseReversalProfile(
  fixes: ProfileFix[],
  reversal: Procedure['courseReversal'] | null | undefined,
): ProfileCourseReversal | null {
  if (!reversal) return null
  const anchor = resolveReversalAnchor(fixes, reversal)
  if (!anchor) return null
  return {
    anchorFixIdx: anchor.idx,
    anchorIsIaf: anchor.viaFallback,
    entryConstraint: reversal.entryAlt,
    entryAltFt: resolveAltConstraint(reversal.entryAlt),
    vertexConstraint: reversal.alt,
    vertexAltFt: resolveAltConstraint(reversal.alt),
    outboundCourse: reversal.outboundCourseMag,
    inboundCourse: reversal.inboundCourseMag,
    turnRight: reversal.turnRight,
    limitNm: reversal.limitNm,
  }
}

/**
 * Build the ProfileHoldInLieu for a fix list, or null when the approach has no
 * HILPT or its fix isn't a profile fix. Pure — pixels are ProfileSvg's job.
 */
export function holdInLieuProfile(
  fixes: ProfileFix[],
  hold: Procedure['holdInLieu'] | null | undefined,
): ProfileHoldInLieu | null {
  if (!hold) return null
  const anchorFixIdx = fixes.findIndex((f) => f.fixId === hold.fixId)
  if (anchorFixIdx === -1) return null
  return {
    anchorFixIdx,
    inboundCourse: hold.inboundCourseMag,
    outboundCourse: hold.outboundCourseMag,
    alt: hold.alt,
    altFt: resolveAltConstraint(hold.alt),
    legNm: hold.legNm,
  }
}

/**
 * Build the vertical-profile model for one procedure transition: cumulative
 * along-track distance, per-fix altitude/speed constraints, the MAP split,
 * holds, and glideslope/runway metadata.
 */
export function buildProfileModel(p: Procedure, t: ProcedureTransition, rwy: CifpRunwayInfo | null): ProfileModel {
  const precision = isPrecisionProcedure(p)
  const legs = t.legs

  // Group consecutive legs that sit at (approximately) the same point.
  const groups: ProcedureLeg[][] = []
  for (const leg of legs) {
    const current = groups[groups.length - 1]
    if (current) {
      const prev = current[current.length - 1]
      const d = turf.distance(turf.point([prev.lon, prev.lat]), turf.point([leg.lon, leg.lat]), NM)
      if (d < SAME_FIX_EPS_NM) {
        current.push(leg)
        continue
      }
    }
    groups.push([leg])
  }

  // Marker beacons are tagged on the procedure's symbols (by fix id) during
  // parsing (LOM detection); carry them onto the matching profile fix.
  const symById = new Map(p.symbols.map((s) => [s.id, s]))

  const allFixes: ProfileFix[] = []
  let cumDistNm = 0
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    const rep = group[0]
    if (i > 0) {
      const prevRep = groups[i - 1][0]
      cumDistNm += turf.distance(turf.point([prevRep.lon, prevRep.lat]), turf.point([rep.lon, rep.lat]), NM)
    }

    const merged = mergeGroup(group)
    const plotAltFt = resolveAltConstraint(merged.constraint)
    const isGsIntercept = merged.role === 'faf' && precision

    allFixes.push({
      fixId: merged.fixId,
      distNm: cumDistNm,
      constraint: merged.constraint,
      plotAltFt,
      role: merged.role,
      pathTerm: merged.pathTerm,
      speedKt: merged.speedKt,
      isGsIntercept,
      isDmeArc: merged.isDmeArc,
      dmeNm: merged.dmeNm,
      dmeNavaidId: merged.dmeNavaidId,
      flyover: merged.flyover,
      marker: symById.get(merged.fixId)?.marker ?? null,
      markerLocator: symById.get(merged.fixId)?.markerLocator ?? false,
    })
  }

  const mapIdx = allFixes.findIndex((f) => f.role === 'map')
  const splitIdx = mapIdx === -1 ? allFixes.length - 1 : mapIdx
  const fixesPreDrop = allFixes.slice(0, splitIdx + 1)
  const missed = allFixes.slice(splitIdx + 1)

  const holdsPreDrop: ProfileHold[] = []
  for (let i = 0; i < groups.length; i++) {
    const holdLeg = groups[i].find((l) => HOLD_PATH_TERMS.has(l.pathTerm))
    if (!holdLeg) continue
    const inMissed = i > splitIdx
    const atFixIdx = inMissed ? i - splitIdx - 1 : i
    holdsPreDrop.push({ atFixIdx, inMissed, kind: holdLeg.pathTerm as ProfileHold['kind'] })
  }

  // ── PT-aware fix selection: drop pre-anchor fixes that are flat at the PT
  //    altitude, then remap non-missed hold indices onto the surviving fixes. ──
  const keep = ptKeepMask(fixesPreDrop, p.courseReversal)
  const fixes = fixesPreDrop.filter((_, i) => keep[i])
  const origToNew: (number | null)[] = []
  let newIdx = 0
  for (let i = 0; i < fixesPreDrop.length; i++) {
    if (keep[i]) origToNew[i] = newIdx++
    else origToNew[i] = null
  }
  const holds: ProfileHold[] = []
  for (const h of holdsPreDrop) {
    if (h.inMissed) {
      holds.push(h)
      continue
    }
    const remapped = origToNew[h.atFixIdx]
    if (remapped != null) holds.push({ ...h, atFixIdx: remapped })
  }

  const courseReversal = courseReversalProfile(fixes, p.courseReversal)
  const holdInLieu = holdInLieuProfile(fixes, p.holdInLieu)

  const gsAngleDeg = p.gpaDeg ?? 3.0
  const usedFallbackGs = p.gpaDeg == null
  const tchFt = p.tchFt ?? null
  const tdzeFt = rwy?.thresholdElevFt ?? null
  const runwayLengthFt = rwy?.lengthFt ?? null
  const totalNm = allFixes.reduce((max, f) => Math.max(max, f.distNm), 0)
  const appCourseMag = approachCourseMag(legs)
  const hasChartedVerticalGuidance = p.gsSource === 'pathPoint' || p.gsSource === 'ilsGs'

  return {
    procedureId: p.id,
    name: p.name,
    fixes,
    missed,
    gsAngleDeg,
    usedFallbackGs,
    tchFt,
    tdzeFt,
    runwayLengthFt,
    totalNm,
    holds,
    appCourseMag,
    hasChartedVerticalGuidance,
    courseReversal,
    holdInLieu,
  }
}

/** Expected glideslope altitude (ft MSL) at a given distance from the threshold. */
export function glideslopeAltAt(model: ProfileModel, distFromThresholdNm: number): number {
  const tdze = model.tdzeFt ?? 0
  const tch = model.tchFt ?? 50
  return tdze + tch + distFromThresholdNm * Math.tan((model.gsAngleDeg * Math.PI) / 180) * FEET_PER_NM
}

/**
 * The vertices (distNm, altFt) of the primary descent path, in domain units
 * (not pixels). Connects fix altitudes directly — no step-downs — up through
 * the glideslope-intercept fix (or the FAF, on non-precision approaches where
 * no fix is flagged isGsIntercept); from there to the runway threshold the
 * path follows the computed glideslope altitude rather than the last
 * approach fix's own (often threshold-adjacent, sometimes unconstrained)
 * plotted altitude. See ProfileSvg.tsx, requirement #1 (linear descent path).
 */
/**
 * The altitude to PLOT for each approach fix. Fixes that carry a crossing
 * restriction use it; unconstrained intermediate fixes (e.g. a step-down or
 * turn fix with no published altitude) are linearly interpolated by distance
 * between their nearest constrained neighbours, so they sit on the descent
 * line instead of collapsing to the runway elevation. The last fix (runway/
 * threshold) is anchored to the glideslope's threshold-crossing altitude.
 *
 * This is a pure function of the model, so the plotted profile never depends
 * on anything but the procedure data.
 */
export function fixRenderAltitudes(model: ProfileModel): number[] {
  const fixes = model.fixes
  const n = fixes.length
  if (n === 0) return []

  const alt: (number | null)[] = fixes.map((f) => f.plotAltFt)
  // Anchor the endpoints so interior interpolation always has both brackets.
  if (alt[n - 1] == null) alt[n - 1] = glideslopeAltAt(model, 0)
  if (alt[0] == null) alt[0] = alt.find((a) => a != null) ?? model.tdzeFt ?? 0

  for (let i = 0; i < n; ) {
    if (alt[i] != null) {
      i++
      continue
    }
    const j = i - 1 // previous fix with a known altitude (alt[0] is set above)
    let k = i + 1
    while (k < n && alt[k] == null) k++ // next fix with a known altitude (alt[n-1] is set)
    const aj = alt[j] as number
    const ak = alt[k] as number
    const dj = fixes[j].distNm
    const dk = fixes[k].distNm
    for (let m = i; m < k; m++) {
      const t = dk === dj ? 0 : (fixes[m].distNm - dj) / (dk - dj)
      alt[m] = aj + (ak - aj) * t
    }
    i = k
  }

  return alt as number[]
}

export function descentProfilePoints(model: ProfileModel): { distNm: number; altFt: number }[] {
  if (model.fixes.length === 0) return []

  const alts = fixRenderAltitudes(model)
  const thresholdDistNm = model.fixes[model.fixes.length - 1].distNm
  const anchorIdx = model.fixes.findIndex((f) => f.isGsIntercept || f.role === 'faf')

  if (anchorIdx === -1) {
    return model.fixes.map((f, i) => ({ distNm: f.distNm, altFt: alts[i] }))
  }

  const points = model.fixes.slice(0, anchorIdx + 1).map((f, i) => ({ distNm: f.distNm, altFt: alts[i] }))
  points.push({ distNm: thresholdDistNm, altFt: glideslopeAltAt(model, 0) })
  return points
}

/** Along-track distance (nm) between each consecutive pair of fixes. */
export function segmentDistancesNm(fixes: { distNm: number }[]): number[] {
  const out: number[] = []
  for (let i = 1; i < fixes.length; i++) out.push(fixes[i].distNm - fixes[i - 1].distNm)
  return out
}

/**
 * Vertical pixel offsets (0..maxOffsetPx) for a row of fix-name labels so
 * they step down following the descent, like the FAA plate (highest fix's
 * label sits at the top of the band, lower fixes' labels progressively
 * lower). `null` altitudes (unconstrained fixes) repeat the previous fix's
 * offset rather than collapsing to 0.
 */
export function labelStaggerOffsets(altsFt: (number | null)[], maxOffsetPx: number): number[] {
  const known = altsFt.filter((a): a is number => a != null)
  if (known.length === 0) return altsFt.map(() => 0)

  const lo = Math.min(...known)
  const hi = Math.max(...known)
  const span = hi - lo || 1

  let last = 0
  return altsFt.map((a) => {
    if (a == null) return last
    last = ((hi - a) / span) * maxOffsetPx
    return last
  })
}

/**
 * Project (lat, lon) onto the transition's leg-to-leg line, returning the
 * along-track distance from the first leg and the cross-track offset —
 * both in nautical miles.
 */
export function alongTrackNm(t: ProcedureTransition, lat: number, lon: number): { distNm: number; xtNm: number } {
  const coords: [number, number][] = t.legs.map((l) => [l.lon, l.lat])
  if (coords.length < 2) return { distNm: 0, xtNm: 0 }

  const line = turf.lineString(coords)
  const pt = turf.point([lon, lat])
  const nearest = turf.nearestPointOnLine(line, pt, NM)
  return { distNm: nearest.properties.location ?? 0, xtNm: nearest.properties.dist ?? 0 }
}

/**
 * Label anti-collision for the live-aircraft glyphs on the profile: decides
 * whether each entry's callsign label should sit 'above' or 'below' its dot.
 * Entries are walked in `distNm` order; when two consecutive entries would sit
 * closer than `minGapPx` on screen (`nmPerPx` converts the along-track domain
 * to pixels, matching the caller's x-scale), the later one flips to the
 * opposite side of its predecessor so the labels don't overlap. Widely-spaced
 * entries all default to 'above'. Returned in the same order as `entries`
 * (not the sorted order used internally) and is a pure function of its inputs.
 */
export function placeProfileLabels(
  entries: { distNm: number }[],
  nmPerPx: number,
  minGapPx = 40,
): Array<'above' | 'below'> {
  const order = entries.map((_, i) => i).sort((a, b) => entries[a].distNm - entries[b].distNm)
  const placement: Array<'above' | 'below'> = entries.map(() => 'above')

  let prevIdx: number | null = null
  for (const idx of order) {
    if (prevIdx !== null) {
      const gapPx = nmPerPx > 0 ? Math.abs(entries[idx].distNm - entries[prevIdx].distNm) / nmPerPx : Infinity
      placement[idx] = gapPx < minGapPx ? (placement[prevIdx] === 'above' ? 'below' : 'above') : 'above'
    }
    prevIdx = idx
  }

  return placement
}
