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

const ROLE_RANK: Record<WaypointRole, number> = { map: 5, faf: 4, iaf: 3, hold: 2, normal: 1 }

const HOLD_PATH_TERMS = new Set(['HM', 'HF', 'HA', 'PI'])

/** A live aircraft's position on the profile (see ProfilePanel/ProfileSvg). */
export interface LiveAircraft {
  distNm: number
  altFt: number
  label: string
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
}

export interface ProfileHold {
  atFixIdx: number
  inMissed: boolean
  kind: 'HM' | 'HF' | 'HA' | 'PI'
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
    })
  }

  const mapIdx = allFixes.findIndex((f) => f.role === 'map')
  const splitIdx = mapIdx === -1 ? allFixes.length - 1 : mapIdx
  const fixes = allFixes.slice(0, splitIdx + 1)
  const missed = allFixes.slice(splitIdx + 1)

  const holds: ProfileHold[] = []
  for (let i = 0; i < groups.length; i++) {
    const holdLeg = groups[i].find((l) => HOLD_PATH_TERMS.has(l.pathTerm))
    if (!holdLeg) continue
    const inMissed = i > splitIdx
    const atFixIdx = inMissed ? i - splitIdx - 1 : i
    holds.push({ atFixIdx, inMissed, kind: holdLeg.pathTerm as ProfileHold['kind'] })
  }

  const gsAngleDeg = p.gpaDeg ?? 3.0
  const usedFallbackGs = p.gpaDeg == null
  const tchFt = p.tchFt ?? null
  const tdzeFt = rwy?.thresholdElevFt ?? null
  const runwayLengthFt = rwy?.lengthFt ?? null
  const totalNm = allFixes.reduce((max, f) => Math.max(max, f.distNm), 0)

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
