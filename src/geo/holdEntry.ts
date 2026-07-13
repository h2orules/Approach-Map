import * as turf from '@turf/turf'
import type { Feature } from 'geojson'
import {
  HOLD_ENTRY_BRG_DEG,
  HOLD_ENTRY_MAX_ETA_S,
  HOLD_ENTRY_PASS_NM,
  HOLD_ENTRY_ALT_TOL_FT,
  HOLD_ENTRY_CLEAR_POLLS,
  HOLD_ENTRY_TEARDROP_OFFSET_DEG,
  HOLD_MATCH_DIR_DEG,
} from '../config/constants'
import { bearingDelta } from './lineMatching'
import { dest, semicircle, HOLD_TURN_R, clampHoldLeg } from './procedureShapes'
import { magneticToTrue } from '../utils/arincRecords'
import type { Procedure, AltConstraint } from '../types/procedure'
import type { InterpolatedAircraft } from '../types/aircraft'
import type { HoldSpec, HoldEntryKind, HoldEntryPrediction, PredictedPath } from '../types/path'

type Pt = [number, number]

const NM = { units: 'nauticalmiles' as const }
const DEG = Math.PI / 180
const norm360 = (d: number): number => ((d % 360) + 360) % 360

// Crossing the fix / "established inbound" gates (module-internal conventions).
const FIX_CROSS_NM = 0.5
const ESTABLISHED_TRACK_DEG = 20
const ESTABLISHED_XT_NM = 0.5
// Lateral offset of the drawn parallel-entry outbound leg on the non-holding side.
const PARALLEL_OFFSET_NM = 0.5
// Default drawn leg length when the CIFP hold feature carries none.
const DEFAULT_HOLD_LEG_NM = 4
// Clear an entry that has gone this long without a qualifying poll, regardless
// of the divergence heuristic. Guards a deadlock where an aircraft neither
// closes on the fix (so `divergedPolls` never increments), diverges, nor
// establishes inbound — e.g. orbiting just off the fix — which would otherwise
// strand the loop on screen indefinitely. ~a couple of polls past the last good one.
const HOLD_ENTRY_STALE_MS = 60_000

// ── Hold-spec collection ────────────────────────────────────────────────────

const specCache = new WeakMap<Procedure, HoldSpec[]>()

/**
 * Extract every published hold from the given procedures as flat, true-course
 * HoldSpecs. Sources: `kind:'hold'` GeoJSON features (HM/HF/HA racetracks the
 * parser emits — geometry-authoritative, see `drawnHoldGeometry`) and
 * `Procedure.holdInLieu` (fallback only), deduped by procId+fixId: the drawn
 * feature wins, and a transition hold beats a missed hold at the same fix.
 * Cached per Procedure object via WeakMap, so repeat calls are cheap and
 * return identity-stable spec objects.
 */
export function collectHoldSpecs(procs: Procedure[]): HoldSpec[] {
  const out: HoldSpec[] = []
  for (const proc of procs) {
    let specs = specCache.get(proc)
    if (!specs) {
      specs = buildSpecs(proc)
      specCache.set(proc, specs)
    }
    out.push(...specs)
  }
  return out
}

function findFix(proc: Procedure, fixId: string): { lat: number; lon: number } | null {
  const w =
    proc.waypoints.find((x) => x.id === fixId) ?? proc.symbols.find((x) => x.id === fixId)
  return w ? { lat: w.lat, lon: w.lon } : null
}

interface DrawnHold {
  fixLat: number
  fixLon: number
  inboundCourseTrue: number
  turnRight: boolean
  legNm: number
}

/**
 * Everything orientation-related a HoldSpec needs, derived purely from the
 * drawn racetrack's own coordinates. `holdTrack` emits `[A, F, …loop…]`: A is
 * the start of the inbound straight and F the fix, so
 *   - fix        = coords[1]
 *   - inbound    = geodetic bearing A → F (already TRUE — no magvar involved)
 *   - leg length = |A → F|
 *   - turn dir   = which side of the inbound course line the loop's points
 *                  fall on (net signed cross-track > 0 ⇒ right of course ⇒
 *                  right turns)
 * Deriving from geometry instead of the feature's coded props means the entry
 * can NEVER mirror, rotate, or tilt relative to the racetrack the user sees —
 * even if the props (or the parser's course/magvar handling — under separate
 * investigation) are wrong. Returns null for degenerate geometry, in which
 * case the caller falls back to the coded props.
 */
function drawnHoldGeometry(f: Feature): DrawnHold | null {
  if (f.geometry.type !== 'LineString') return null
  const c = f.geometry.coordinates as Pt[]
  if (c.length < 4) return null // need the loop, not just a straight
  const A = c[0]
  const F = c[1]
  const legNm = turf.distance(turf.point(A), turf.point(F), NM)
  if (legNm < 0.1) return null
  const inb = norm360(turf.bearing(turf.point(A), turf.point(F)))
  const fixPt = turf.point(F)
  let side = 0 // Σ signed cross-track of the loop's points
  for (const p of c) {
    const d = turf.distance(fixPt, turf.point(p), NM)
    const b = turf.bearing(fixPt, turf.point(p))
    const theta = ((b - inb + 540) % 360) - 180
    side += d * Math.sin(theta * DEG)
  }
  return { fixLat: F[1], fixLon: F[0], inboundCourseTrue: inb, turnRight: side > 0, legNm }
}

function buildSpecs(proc: Procedure): HoldSpec[] {
  const byKey = new Map<string, HoldSpec>()
  const magVar = proc.magVarDeg ?? 0

  // Drawn `kind:'hold'` racetracks FIRST — they are exactly what the user sees,
  // so the entry's orientation (turn direction, inbound course) and anchor can
  // never disagree with the drawn shape. This is the load-bearing fix for the
  // "mirrored on the wrong side" defect: the old code let `holdInLieu` win, and
  // a HILPT/missed pair at one fix could publish opposite turns, drawing the
  // entry on the far side of the racetrack. On a same-fix collision (a
  // transition HILPT and a missed hold sharing one fix with different
  // courses/turns) the transition hold wins — it's the one an arriving aircraft
  // is predicted to enter.
  for (const f of proc.geojson.features) {
    const p = f.properties as Record<string, unknown> | null
    if (!p || p.kind !== 'hold') continue
    if (typeof p.fixId !== 'string' || typeof p.inboundCourseMag !== 'number') continue
    const key = `${proc.id}|${p.fixId}`
    const segment: HoldSpec['segment'] = p.segment === 'missed' ? 'missed' : 'transition'
    const existing = byKey.get(key)
    // Keep the existing spec unless we're upgrading a missed hold to the
    // transition hold at the same fix.
    if (existing && !(existing.segment === 'missed' && segment === 'transition')) continue
    // The drawn coordinates are authoritative for EVERYTHING geometric —
    // anchor, inbound course, holding side, leg length — so the entry can
    // never mirror or rotate off the on-screen racetrack (LOFAL defect: the
    // coded props' course/turn can disagree with the drawn loop). The coded
    // props are only a fallback for degenerate geometry.
    const g = drawnHoldGeometry(f)
    if (g) {
      byKey.set(key, {
        key,
        procId: proc.id,
        fixId: p.fixId,
        fixLat: g.fixLat,
        fixLon: g.fixLon,
        inboundCourseTrue: g.inboundCourseTrue,
        turnRight: g.turnRight,
        legNm: g.legNm,
        alt: (p.alt as AltConstraint | null | undefined) ?? null,
        segment,
      })
      continue
    }
    const pos = findFix(proc, p.fixId)
    if (!pos) continue
    byKey.set(key, {
      key,
      procId: proc.id,
      fixId: p.fixId,
      fixLat: pos.lat,
      fixLon: pos.lon,
      inboundCourseTrue: magneticToTrue(p.inboundCourseMag, magVar),
      turnRight: p.turnRight === true,
      legNm: DEFAULT_HOLD_LEG_NM,
      alt: (p.alt as AltConstraint | null | undefined) ?? null,
      segment,
    })
  }

  // Hold-in-lieu-of-PT: only when no drawn racetrack already covers the fix. In
  // practice an HF leg always emits a drawn `kind:'hold'` feature too, so this
  // is a safety fallback (it carries the published leg length).
  const hil = proc.holdInLieu
  if (hil) {
    const key = `${proc.id}|${hil.fixId}`
    if (!byKey.has(key)) {
      const pos = findFix(proc, hil.fixId)
      if (pos) {
        byKey.set(key, {
          key,
          procId: proc.id,
          fixId: hil.fixId,
          fixLat: pos.lat,
          fixLon: pos.lon,
          inboundCourseTrue: magneticToTrue(hil.inboundCourseMag, magVar),
          turnRight: hil.turnRight,
          legNm: hil.legNm > 0 ? hil.legNm : DEFAULT_HOLD_LEG_NM,
          alt: hil.alt ?? null,
          segment: 'transition',
        })
      }
    }
  }

  return [...byKey.values()]
}

// ── Entry classification (AIM 5-3-8) ────────────────────────────────────────

/**
 * Which entry the FAA recommends for an aircraft crossing the fix on
 * `inboundTrackAtFixTrue` into a hold whose inbound course is
 * `holdInboundTrue`. Sectors (right-turn hold, r = track − holdInbound,
 * normalized 0–360): parallel r ∈ (70, 180], teardrop r ∈ (180, 250], direct
 * otherwise. Left-turn holds mirror via r → 360 − r. Boundaries pinned:
 * exactly 70 → direct, exactly 180 → parallel, exactly 250 → teardrop.
 */
export function classifyHoldEntry(
  inboundTrackAtFixTrue: number,
  holdInboundTrue: number,
  turnRight: boolean,
): HoldEntryKind {
  let r = norm360(inboundTrackAtFixTrue - holdInboundTrue)
  if (!turnRight) r = norm360(360 - r)
  if (r > 70 && r <= 180) return 'parallel'
  if (r > 180 && r <= 250) return 'teardrop'
  return 'direct'
}

// ── Entry path geometry ─────────────────────────────────────────────────────

/** Constant-radius turn from heading `hIn` to heading `hOut` in the given turn
 *  direction, starting at `from`. Returns the arc points including both ends. */
function turnArc(from: Pt, hIn: number, hOut: number, right: boolean, r: number): Pt[] {
  const center = dest(from, r, hIn + (right ? 90 : -90))
  const startBrg = hIn + (right ? -90 : 90)
  const sweep = right ? norm360(hOut - hIn) : -norm360(hIn - hOut)
  const steps = Math.max(4, Math.ceil(Math.abs(sweep) / 10))
  const out: Pt[] = []
  for (let i = 0; i <= steps; i++) out.push(dest(center, r, startBrg + (sweep * i) / steps))
  return out
}

/**
 * A 45°-style intercept from `from` back onto the hold's inbound course line,
 * then the final run to the fix. Places the join point so the last segment
 * lies exactly on the inbound course. Returns `[joinPoint, fix]`.
 */
function interceptToFix(from: Pt, fix: Pt, recip: number): Pt[] {
  const d = turf.distance(turf.point(fix), turf.point(from), NM)
  const brg = turf.bearing(turf.point(fix), turf.point(from))
  const theta = ((brg - recip + 540) % 360) - 180
  const along = d * Math.cos(theta * DEG)
  const cross = Math.abs(d * Math.sin(theta * DEG))
  const backNm = Math.max(along - cross, 0.05)
  return [dest(fix, backNm, recip), fix]
}

/**
 * The predicted entry path as a [lon, lat] polyline starting at the hold fix,
 * using the same turn radius (HOLD_TURN_R) and clamped leg length the drawn
 * racetrack uses, so entries visually mate with the published hold shape.
 * Every variant's final segment lies exactly on the inbound course to the fix.
 */
export function holdEntryPath(spec: HoldSpec, entry: HoldEntryKind): [number, number][] {
  const F: Pt = [spec.fixLon, spec.fixLat]
  const inb = spec.inboundCourseTrue
  const right = spec.turnRight
  const recip = norm360(inb + 180)
  const side = norm360(inb + (right ? 90 : -90))
  const L = clampHoldLeg(spec.legNm)
  const r = HOLD_TURN_R

  if (entry === 'direct') {
    // The racetrack itself, flown from the fix: near-end turn to outbound,
    // outbound leg, far turn, inbound leg back to the fix. Identical anchor
    // points and semicircles to holdTrack, just rotated to begin at F.
    const A = dest(F, L, recip)
    const C = dest(A, 2 * r, side)
    // nearArc already ends at the abeam-fix point B, so don't re-emit an
    // explicit B: the two are ~0.4 m apart (great-circle two-hop vs one-hop),
    // and the duplicate created a zero-ish segment that read as a 180° reversal.
    const nearArc = semicircle(dest(F, r, side), r, norm360(side + 180), right) // F → B
    const farArc = semicircle(dest(A, r, side), r, side, right) // C → A
    return [F, ...nearArc.slice(1), C, ...farArc.slice(1), F]
  }

  if (entry === 'teardrop') {
    // Outbound on the reciprocal offset 30° toward the holding side, one leg
    // length, then a turn in the hold's direction that rolls out on a 45°
    // intercept heading (NOT parallel to the course), so the straight run to
    // the fix converges cleanly. Turning all the way to the inbound heading
    // used to leave the aircraft parallel-but-offset, and interceptToFix — which
    // assumes a 45° intercept — then inserted a backward dog-leg (the visible
    // mid-path jog). The intercept comes from the holding side, so the turn is
    // toward the course: inb − 45° for a right hold, inb + 45° for a left hold.
    const out = norm360(recip + (right ? -1 : 1) * HOLD_ENTRY_TEARDROP_OFFSET_DEG)
    const T = dest(F, L, out)
    const intercept = norm360(inb + (right ? -45 : 45))
    const arc = turnArc(T, out, intercept, right, r)
    return [F, T, ...arc.slice(1), ...interceptToFix(arc[arc.length - 1], F, recip)]
  }

  // Parallel: outbound past the fix parallel to the reciprocal, offset onto the
  // NON-holding side, one leg length, then a >180° turn in the hold's direction
  // (through the outbound and inbound headings to a 45° intercept heading),
  // rejoining the inbound course outside the fix.
  const nonSide = norm360(inb + (right ? -90 : 90))
  const OE = dest(dest(F, L, recip), PARALLEL_OFFSET_NM, nonSide)
  const arc = turnArc(OE, recip, norm360(inb + (right ? 45 : -45)), right, r)
  return [F, OE, ...arc.slice(1), ...interceptToFix(arc[arc.length - 1], F, recip)]
}

// ── Trigger evaluation ──────────────────────────────────────────────────────

function altWithinTolerance(alt: AltConstraint, altFt: number): boolean {
  const tol = HOLD_ENTRY_ALT_TOL_FT
  switch (alt.type) {
    case 'AT':
    case 'AT_OR_ABOVE':
      return altFt >= alt.low - tol
    case 'AT_OR_BELOW':
      return altFt <= (alt.high ?? alt.low) + tol
    case 'BETWEEN':
      return altFt >= alt.low - tol && altFt <= (alt.high ?? alt.low) + tol
  }
}

interface Qualification {
  spec: HoldSpec
  distNm: number
  /** Predicted track arriving at the fix — classification input. */
  arrivalTrack: number
}

function evaluateTrigger(
  ac: InterpolatedAircraft,
  spec: HoldSpec,
  pred: PredictedPath | undefined,
): Qualification | null {
  const acPt = turf.point([ac.lon, ac.lat])
  const fixPt = turf.point([spec.fixLon, spec.fixLat])
  const distNm = turf.distance(acPt, fixPt, NM)

  // Headed at the fix.
  if (bearingDelta(ac.track, turf.bearing(acPt, fixPt)) > HOLD_ENTRY_BRG_DEG) return null

  // Arriving soon.
  if (ac.groundspeed <= 0) return null
  if ((distNm / ac.groundspeed) * 3600 > HOLD_ENTRY_MAX_ETA_S) return null

  // Predicted path actually passes the fix.
  if (!pred || pred.points.length === 0) return null
  let minD = Infinity
  let minIdx = 0
  for (let i = 0; i < pred.points.length; i++) {
    const p = pred.points[i]
    const d = turf.distance(turf.point([p.lon, p.lat]), fixPt, NM)
    if (d < minD) {
      minD = d
      minIdx = i
    }
  }
  if (minD > HOLD_ENTRY_PASS_NM) return null

  // Not already established on the inbound course.
  const recip = norm360(spec.inboundCourseTrue + 180)
  const brgFromFix = turf.bearing(fixPt, acPt)
  const theta = ((brgFromFix - recip + 540) % 360) - 180
  const xtNm = Math.abs(distNm * Math.sin(theta * DEG))
  const aligned = bearingDelta(ac.track, spec.inboundCourseTrue) <= ESTABLISHED_TRACK_DEG
  if (aligned && xtNm <= ESTABLISHED_XT_NM) return null

  // Predicted altitude at the fix within tolerance of the hold's constraint.
  if (spec.alt && !altWithinTolerance(spec.alt, pred.points[minIdx].altFt)) return null

  const prevPt = minIdx > 0 ? pred.points[minIdx - 1] : null
  const arrivalTrack = prevPt
    ? norm360(
        turf.bearing(
          turf.point([prevPt.lon, prevPt.lat]),
          turf.point([pred.points[minIdx].lon, pred.points[minIdx].lat]),
        ),
      )
    : ac.track
  return { spec, distNm, arrivalTrack }
}

// ── Reducer ─────────────────────────────────────────────────────────────────

export interface HoldEntryState {
  entries: Map<string, HoldEntryPrediction>
  /** Last poll's distance-to-fix per hex — divergence bookkeeping. */
  lastDistNm: Map<string, number>
}

export function emptyHoldEntryState(): HoldEntryState {
  return { entries: new Map(), lastDistNm: new Map() }
}

export interface HoldEntryInput {
  nowMs: number
  aircraft: readonly InterpolatedAircraft[]
  predictions: ReadonlyMap<string, PredictedPath>
  specs: readonly HoldSpec[]
  assignments: Readonly<Record<string, string>>
}

/**
 * Per-poll hold-entry lifecycle. Pure: returns fresh Maps; record objects and
 * their `path` arrays keep identity across polls. Entry kind and path FREEZE
 * at first qualification — only a spec change (which is itself locked out
 * once the fix is crossed) regenerates them. An entry clears when its aircraft
 * gains an approach assignment, becomes established inbound after crossing the
 * fix, diverges for HOLD_ENTRY_CLEAR_POLLS consecutive non-qualifying polls,
 * goes HOLD_ENTRY_STALE_MS without qualifying, or vanishes.
 */
export function reduceHoldEntries(prev: HoldEntryState, input: HoldEntryInput): HoldEntryState {
  const entries = new Map<string, HoldEntryPrediction>()
  const lastDistNm = new Map<string, number>()
  const specByKey = new Map(input.specs.map((s) => [s.key, s]))

  for (const ac of input.aircraft) {
    const hex = ac.hex
    if (input.assignments[hex]) continue // assignment appeared (or exists) → no entry

    const pred = input.predictions.get(hex)
    const prevRec = prev.entries.get(hex)

    // Closest qualifying spec this poll.
    let best: Qualification | null = null
    for (const spec of input.specs) {
      const q = evaluateTrigger(ac, spec, pred)
      if (q && (!best || q.distNm < best.distNm)) best = q
    }

    if (!prevRec) {
      if (!best) continue
      const entry = classifyHoldEntry(best.arrivalTrack, best.spec.inboundCourseTrue, best.spec.turnRight)
      entries.set(hex, {
        hex,
        specKey: best.spec.key,
        entry,
        path: holdEntryPath(best.spec, entry),
        lastQualifiedMs: input.nowMs,
        divergedPolls: 0,
        crossedFix: best.distNm <= FIX_CROSS_NM,
      })
      lastDistNm.set(hex, best.distNm)
      continue
    }

    // Once the fix is crossed the aircraft is EXECUTING the entry: lock the
    // spec — switching to another hold mid-entry (and regenerating from it)
    // flips the loop onto the reciprocal side of the fix.
    const specChanged = !prevRec.crossedFix && best !== null && best.spec.key !== prevRec.specKey
    const spec = specChanged && best ? best.spec : specByKey.get(prevRec.specKey)
    if (!spec) continue // spec no longer published

    const sameSpecBest = best !== null && best.spec.key === spec.key ? best : null
    const distNm = sameSpecBest
      ? sameSpecBest.distNm
      : turf.distance(turf.point([ac.lon, ac.lat]), turf.point([spec.fixLon, spec.fixLat]), NM)
    const crossedFix = (specChanged ? false : prevRec.crossedFix) || distNm <= FIX_CROSS_NM

    // Established in the hold → prediction served its purpose.
    if (crossedFix && bearingDelta(ac.track, spec.inboundCourseTrue) <= HOLD_MATCH_DIR_DEG) continue

    let rec: HoldEntryPrediction
    if (sameSpecBest) {
      // Entry kind and path FREEZE at first qualification: re-deriving the
      // arrival track on later polls (especially from predicted points at or
      // past the fix) yields reciprocal-course garbage that re-classified the
      // entry and rebuilt the loop flipped along the course axis (LOFAL
      // defect 2). Only a genuine spec change re-classifies and regenerates.
      const entry = specChanged
        ? classifyHoldEntry(sameSpecBest.arrivalTrack, spec.inboundCourseTrue, spec.turnRight)
        : prevRec.entry
      rec = {
        ...prevRec,
        specKey: spec.key,
        entry,
        path: specChanged ? holdEntryPath(spec, entry) : prevRec.path,
        lastQualifiedMs: input.nowMs,
        divergedPolls: 0,
        crossedFix,
      }
    } else {
      // Hard stale-out: clear regardless of geometry once too long has passed
      // without a qualifying poll (breaks the "distance flat, trigger failing
      // forever" deadlock that would otherwise never increment divergedPolls).
      if (input.nowMs - prevRec.lastQualifiedMs >= HOLD_ENTRY_STALE_MS) continue
      let diverged = prevRec.divergedPolls
      const lastDist = prev.lastDistNm.get(hex)
      if (lastDist !== undefined && distNm > lastDist) diverged += 1
      if (diverged >= HOLD_ENTRY_CLEAR_POLLS) continue
      rec = { ...prevRec, divergedPolls: diverged, crossedFix }
    }
    entries.set(hex, rec)
    lastDistNm.set(hex, distNm)
  }

  return { entries, lastDistNm }
}
