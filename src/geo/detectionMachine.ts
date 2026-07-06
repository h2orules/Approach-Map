import type { InterpolatedAircraft } from '../types/aircraft'
import type { Procedure } from '../types/procedure'
import type { AtisInfo } from '../api/datis'
import { evaluateMatch, type MatchTolerances, type AirportContext } from './procedureMatch'
import { approachPriority, approachRunwayKey } from './approachPriority'
import {
  DETECT_CANDIDATE_XT_APPROACH_NM,
  DETECT_CANDIDATE_XT_SIDSTAR_NM,
  DETECT_CANDIDATE_DIR_DEG,
  DETECT_CANDIDATE_ALT_CONSTRAINED_FT,
  DETECT_CANDIDATE_ALT_NEAR_FT,
  DETECT_CANDIDATE_ALT_FAR_FT,
  DETECT_CONFIRMED_XT_APPROACH_NM,
  DETECT_CONFIRMED_XT_SIDSTAR_NM,
  DETECT_CONFIRMED_DIR_DEG,
  DETECT_CONFIRM_MIN_MATCHES,
  DETECT_CONFIRM_MIN_DURATION_MS,
  DETECT_CONFIRM_MIN_PROGRESS_NM,
  DETECT_CANDIDATE_TTL_MS,
  DETECT_CONFIRMED_TTL_MS,
  DETECT_REASSIGN_CLOSER_STREAK,
  VFR_SQUAWK,
} from '../config/constants'

export interface ProcTrack {
  procId: string
  phase: 'candidate' | 'confirmed'
  firstMatchMs: number
  lastMatchMs: number
  matchCount: number
  lastCrossTrackNm: number
  /** Along-track position (nm) at the track's first match — confirmation of
   *  SID/STAR tracks requires net progress from here, so aligned-but-loitering
   *  traffic (e.g. VFR circling near a leg) never confirms. */
  firstAlongTrackNm: number
  /** Along-track position (nm) at the latest match. */
  lastAlongTrackNm: number
  /** True once this hex has matched a pre-MAP segment (distinguishes missed
   *  approaches from departures for at/past-MAP evidence). */
  preMapSeen: boolean
  /** Consecutive polls this track has been laterally closer than the hex's
   *  currently-assigned procedure of the same type. Drives sticky reassignment. */
  closerStreak: number
}

export interface DetectionState {
  /** hex → procId → track */
  tracks: Record<string, Record<string, ProcTrack>>
  /** hex → procId (approaches only, exactly one per hex) */
  assignments: Record<string, string>
  /** hex → one confirmed SID and/or STAR procId. Same dedupe idea as approach
   *  `assignments`: sibling SIDs share their initial runway legs, so a single
   *  departure would otherwise light up every one of them. */
  sidStarAssignments: Record<string, Partial<Record<'SID' | 'STAR', string>>>
}

export interface ProcedureActivity {
  hexes: string[]
  lastActiveMs: number
}

export interface DetectionConfig {
  candidate: MatchTolerances
  confirmed: MatchTolerances
  confirmMinMatches: number
  confirmMinDurationMs: number
  /** Net along-track progress a SID/STAR candidate must cover to confirm. */
  confirmMinProgressNm: number
  candidateTtlMs: number
  confirmedTtlMs: number
  reassignCloserStreak: number
}

export type DetectionEvent =
  | { type: 'confirmed'; hex: string; procId: string }
  | { type: 'lost'; hex: string; procId: string }
  | { type: 'assigned'; hex: string; procId: string; prevProcId: string | null }

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  candidate: {
    crossTrackApproachNm: DETECT_CANDIDATE_XT_APPROACH_NM,
    crossTrackSidStarNm: DETECT_CANDIDATE_XT_SIDSTAR_NM,
    directionToleranceDeg: DETECT_CANDIDATE_DIR_DEG,
    altConstrainedFt: DETECT_CANDIDATE_ALT_CONSTRAINED_FT,
    altNearFt: DETECT_CANDIDATE_ALT_NEAR_FT,
    altFarFt: DETECT_CANDIDATE_ALT_FAR_FT,
  },
  confirmed: {
    crossTrackApproachNm: DETECT_CONFIRMED_XT_APPROACH_NM,
    crossTrackSidStarNm: DETECT_CONFIRMED_XT_SIDSTAR_NM,
    directionToleranceDeg: DETECT_CONFIRMED_DIR_DEG,
    // Confirmed tracks don't gate on altOk; these tolerances only shape the
    // altOk evidence flag, so reuse the candidate values.
    altConstrainedFt: DETECT_CANDIDATE_ALT_CONSTRAINED_FT,
    altNearFt: DETECT_CANDIDATE_ALT_NEAR_FT,
    altFarFt: DETECT_CANDIDATE_ALT_FAR_FT,
  },
  confirmMinMatches: DETECT_CONFIRM_MIN_MATCHES,
  confirmMinDurationMs: DETECT_CONFIRM_MIN_DURATION_MS,
  confirmMinProgressNm: DETECT_CONFIRM_MIN_PROGRESS_NM,
  candidateTtlMs: DETECT_CANDIDATE_TTL_MS,
  confirmedTtlMs: DETECT_CONFIRMED_TTL_MS,
  reassignCloserStreak: DETECT_REASSIGN_CLOSER_STREAK,
}

export function initialDetectionState(): DetectionState {
  return { tracks: {}, assignments: {}, sidStarAssignments: {} }
}

/**
 * Pure per-poll reducer. Candidate tolerances gate new/candidate tracks;
 * confirmed tracks are re-evaluated with widened tolerances and don't require
 * altOk (level-offs / go-arounds don't shed the lock — only sustained lateral
 * departure, via TTL, does).
 */
export function reduceDetection(
  prev: DetectionState,
  snapshot: { nowMs: number; aircraft: InterpolatedAircraft[] },
  procedures: Procedure[],
  ctx: AirportContext,
  atisInfo: AtisInfo | null,
  config: DetectionConfig,
): { state: DetectionState; events: DetectionEvent[] } {
  const { nowMs, aircraft } = snapshot
  const events: DetectionEvent[] = []
  const acHexes = new Set(aircraft.map((ac) => ac.hex))
  const procById = new Map(procedures.map((p) => [p.id, p]))

  // Step 1: drop tracks for hexes absent from the snapshot (blip gone). Emit
  // `lost` for any that were confirmed.
  for (const [hex, procTracks] of Object.entries(prev.tracks)) {
    if (acHexes.has(hex)) continue
    for (const t of Object.values(procTracks)) {
      if (t.phase === 'confirmed') events.push({ type: 'lost', hex, procId: t.procId })
    }
  }

  const tracks: Record<string, Record<string, ProcTrack>> = {}

  // Steps 2–5: evaluate, advance, confirm, expire — per aircraft × procedure.
  for (const ac of aircraft) {
    const prevTracks = prev.tracks[ac.hex] ?? {}
    const nextTracks: Record<string, ProcTrack> = {}
    // Known-VFR traffic is never on an IFR clearance, so it never generates
    // evidence — existing tracks (e.g. after an IFR cancellation in the air)
    // simply age out through the normal TTLs.
    const isVfr = ac.squawk === VFR_SQUAWK

    for (const proc of procedures) {
      const existing = prevTracks[proc.id]
      const isConfirmed = existing?.phase === 'confirmed'
      const tol = isConfirmed ? config.confirmed : config.candidate
      const ev = isVfr ? null : evaluateMatch(ac, proc, ctx, tol)

      const preMapSeen = (existing?.preMapSeen ?? false) || (ev?.preMap ?? false)

      let qualifies = false
      if (ev) {
        // Departure/missed gate: an at/past-MAP approach match only counts once
        // the hex has been seen pre-MAP; a fresh hex first seen past the MAP is
        // a departure and never creates a track.
        const mapOk = !(proc.type === 'APPROACH' && ev.pastMap && !preMapSeen)
        // Candidates require altOk; confirmed tracks require only geometry+direction.
        const altGateOk = isConfirmed || ev.altOk
        qualifies = mapOk && altGateOk
      }

      if (qualifies) {
        const firstMatchMs = existing?.firstMatchMs ?? nowMs
        const firstAlongTrackNm = existing?.firstAlongTrackNm ?? ev!.alongTrackNm
        const matchCount = (existing?.matchCount ?? 0) + 1
        let phase: 'candidate' | 'confirmed' = existing?.phase ?? 'candidate'
        // SID/STAR additionally require net along-track progress: matches over
        // time alone are satisfiable by traffic circling near a leg (each lap
        // re-aligns with the local direction), but circling covers no distance
        // along the line. Approaches are exempt (GS/altitude + MAP gates).
        const progressOk =
          proc.type === 'APPROACH' ||
          ev!.alongTrackNm - firstAlongTrackNm >= config.confirmMinProgressNm
        if (
          phase === 'candidate' &&
          matchCount >= config.confirmMinMatches &&
          nowMs - firstMatchMs >= config.confirmMinDurationMs &&
          progressOk
        ) {
          phase = 'confirmed'
          events.push({ type: 'confirmed', hex: ac.hex, procId: proc.id })
        }
        nextTracks[proc.id] = {
          procId: proc.id,
          phase,
          firstMatchMs,
          lastMatchMs: nowMs,
          matchCount,
          lastCrossTrackNm: ev!.crossTrackNm,
          firstAlongTrackNm,
          lastAlongTrackNm: ev!.alongTrackNm,
          preMapSeen,
          closerStreak: existing?.closerStreak ?? 0,
        }
      } else if (existing) {
        // No qualifying match this poll. Keep the track until its TTL lapses.
        const ttl = existing.phase === 'confirmed' ? config.confirmedTtlMs : config.candidateTtlMs
        if (nowMs - existing.lastMatchMs <= ttl) {
          nextTracks[proc.id] =
            existing.preMapSeen === preMapSeen ? existing : { ...existing, preMapSeen }
        } else if (existing.phase === 'confirmed') {
          events.push({ type: 'lost', hex: ac.hex, procId: proc.id })
        }
      }
    }

    if (Object.keys(nextTracks).length > 0) tracks[ac.hex] = nextTracks
  }

  // Step 6: assignment (approaches only; exactly one per hex).
  const assignments: Record<string, string> = {}
  for (const [hex, procTracks] of Object.entries(tracks)) {
    const confirmed = Object.values(procTracks).filter(
      (t) => t.phase === 'confirmed' && procById.get(t.procId)?.type === 'APPROACH',
    )
    if (confirmed.length === 0) continue

    const prio = (procId: string) => approachPriority(procById.get(procId)!, atisInfo)
    const rwyKey = (procId: string) => approachRunwayKey(procById.get(procId)!)

    // Best by ATIS-informed priority, tie-break min cross-track.
    const sorted = [...confirmed].sort((a, b) => {
      const dp = prio(b.procId) - prio(a.procId)
      if (dp !== 0) return dp
      return a.lastCrossTrackNm - b.lastCrossTrackNm
    })
    const best = sorted[0]

    const prevId = prev.assignments[hex]
    const incumbent = prevId ? procTracks[prevId] : undefined
    const incumbentValid =
      !!incumbent && incumbent.phase === 'confirmed' && procById.get(prevId!)?.type === 'APPROACH'

    let winnerId: string
    if (!incumbentValid) {
      winnerId = best.procId
      for (const t of confirmed) t.closerStreak = 0
    } else {
      const inc = incumbent!
      const challenger = sorted.find((t) => t.procId !== prevId)
      if (!challenger) {
        winnerId = prevId!
      } else {
        // Sticky: challenger wins only on strictly higher ATIS priority for the
        // same runway (prompt ATIS flip), or after a sustained closer streak.
        if (challenger.lastCrossTrackNm < inc.lastCrossTrackNm) {
          challenger.closerStreak = challenger.closerStreak + 1
        } else {
          challenger.closerStreak = 0
        }
        const higherPrioSameRwy =
          prio(challenger.procId) > prio(prevId!) && rwyKey(challenger.procId) === rwyKey(prevId!)
        const streakWins = challenger.closerStreak >= config.reassignCloserStreak
        winnerId = higherPrioSameRwy || streakWins ? challenger.procId : prevId!
        for (const t of confirmed) if (t !== challenger) t.closerStreak = 0
      }
    }

    assignments[hex] = winnerId
    if (winnerId !== (prevId ?? null)) {
      events.push({ type: 'assigned', hex, procId: winnerId, prevProcId: prevId ?? null })
    }
  }

  // Step 7: SID/STAR assignment (exactly one of each type per hex). Sibling
  // SIDs share their initial runway legs, so one departure confirms several of
  // them at once — same shape as the parallel-runway approach problem, same
  // fix: pick the laterally closest, keep it sticky, and let a sustained
  // closer streak reassign once the real procedure's path diverges. There is
  // no ATIS-priority rule here (ATIS names runways, not SIDs/STARs).
  const sidStarAssignments: DetectionState['sidStarAssignments'] = {}
  for (const [hex, procTracks] of Object.entries(tracks)) {
    for (const type of ['SID', 'STAR'] as const) {
      const confirmed = Object.values(procTracks).filter(
        (t) => t.phase === 'confirmed' && procById.get(t.procId)?.type === type,
      )
      if (confirmed.length === 0) continue

      const sorted = [...confirmed].sort((a, b) => a.lastCrossTrackNm - b.lastCrossTrackNm)
      const best = sorted[0]

      const prevId = prev.sidStarAssignments[hex]?.[type]
      const incumbent = prevId ? procTracks[prevId] : undefined
      const incumbentValid = !!incumbent && incumbent.phase === 'confirmed'

      let winnerId: string
      if (!incumbentValid) {
        winnerId = best.procId
        for (const t of confirmed) t.closerStreak = 0
      } else {
        const challenger = sorted.find((t) => t.procId !== prevId)
        if (!challenger) {
          winnerId = prevId!
        } else {
          if (challenger.lastCrossTrackNm < incumbent!.lastCrossTrackNm) {
            challenger.closerStreak = challenger.closerStreak + 1
          } else {
            challenger.closerStreak = 0
          }
          winnerId =
            challenger.closerStreak >= config.reassignCloserStreak ? challenger.procId : prevId!
          for (const t of confirmed) if (t !== challenger) t.closerStreak = 0
        }
      }

      ;(sidStarAssignments[hex] ??= {})[type] = winnerId
      if (winnerId !== (prevId ?? null)) {
        events.push({ type: 'assigned', hex, procId: winnerId, prevProcId: prevId ?? null })
      }
    }
  }

  return { state: { tracks, assignments, sidStarAssignments }, events }
}

/**
 * Derive per-procedure active-aircraft sets from detection state. Every
 * procedure type reports only its assigned aircraft (one approach + at most
 * one SID and one STAR per hex), so sibling procedures sharing legs don't all
 * light up. Hex arrays are sorted for deterministic output (stable render,
 * stable tests).
 */
export function deriveProcedureActivity(
  state: DetectionState,
): Record<string, ProcedureActivity> {
  const result: Record<string, ProcedureActivity> = {}

  const add = (procId: string, hex: string, lastMs: number) => {
    const entry = result[procId] ?? { hexes: [], lastActiveMs: 0 }
    entry.hexes.push(hex)
    entry.lastActiveMs = Math.max(entry.lastActiveMs, lastMs)
    result[procId] = entry
  }

  // SID/STAR: the assigned track of each type.
  for (const [hex, byType] of Object.entries(state.sidStarAssignments)) {
    for (const procId of Object.values(byType)) {
      const t = state.tracks[hex]?.[procId]
      if (t) add(procId, hex, t.lastMatchMs)
    }
  }

  // Approaches: only the assigned aircraft.
  for (const [hex, procId] of Object.entries(state.assignments)) {
    const t = state.tracks[hex]?.[procId]
    if (t) add(procId, hex, t.lastMatchMs)
  }

  for (const entry of Object.values(result)) entry.hexes.sort()
  return result
}
