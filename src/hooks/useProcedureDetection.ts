import { useEffect, useRef } from 'react'
import { useAircraftStore } from '../store/useAircraftStore'
import { useProcedureStore } from '../store/useProcedureStore'
import { useAirportStore } from '../store/useAirportStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { detectProceduresInUse } from '../geo/procedureDetection'
import { positionToMinFt, positionToMaxFt } from '../utils/altitudeFilter'
import type { Procedure } from '../types/procedure'
import type { AtisInfo } from '../api/datis'

// Static fallback priority when ATIS is unavailable or doesn't list the type.
// Higher = preferred.
const STATIC_PRIORITY: Record<string, number> = { I: 4, R: 3, H: 2, L: 1 }

/**
 * Extract the runway designator from an approach procedure name.
 * CIFP names: I34L, R34C, H16R, L28, VDME-A.
 * Returns e.g. "34L", "16R", or all runways joined for non-specific approaches.
 */
function approachRunwayKey(proc: Procedure): string {
  const m = proc.name.match(/^[A-Z](\d{2}[LRC]?)/)
  if (m) return m[1]
  return [...proc.runways].sort().join(',')
}

/**
 * Priority score for a procedure, incorporating D-ATIS preferences when available.
 *
 * ATIS-listed types receive a boosted score (100 − position) so they always
 * outrank types not mentioned in the ATIS.  Within ATIS entries the original
 * text order is preserved (ILS before LOC when ATIS says "ILS OR LOC").
 * Non-ATIS types fall back to static I > R > H > L ordering.
 */
function priority(proc: Procedure, rwyKey: string, atisInfo: AtisInfo | null): number {
  const prefix = proc.name[0]?.toUpperCase() ?? ''
  const prefs = atisInfo?.runwayPrefs[rwyKey] ?? []
  const atisIdx = prefs.indexOf(prefix)
  if (atisIdx >= 0) return 100 - atisIdx
  return STATIC_PRIORITY[prefix] ?? 0
}

/**
 * Pass 1 — same runway, competing types (I vs R vs H vs L on the same runway).
 *
 * Strict: keep exactly the ONE highest-priority detected approach per runway.
 * All others are suppressed unconditionally, regardless of which aircraft they
 * matched.  D-ATIS preferences override the static I > R > H > L order.
 *
 * Returns [result, log] where log records what was suppressed and why.
 */
function deduplicateApproaches(
  detected: Record<string, boolean>,
  procedures: Procedure[],
  atisInfo: AtisInfo | null,
): [Record<string, boolean>, Array<{ kept: string; suppressed: string; reason: string }>] {
  const result = { ...detected }
  const log: Array<{ kept: string; suppressed: string; reason: string }> = []

  const approachProcs = procedures.filter((p) => p.type === 'APPROACH' && result[p.id])
  const byRunway = new Map<string, Procedure[]>()
  for (const proc of approachProcs) {
    const key = approachRunwayKey(proc)
    if (!key) continue
    const group = byRunway.get(key) ?? []
    if (!group.includes(proc)) group.push(proc)
    byRunway.set(key, group)
  }

  for (const [rwyKey, group] of byRunway) {
    if (group.length <= 1) continue
    group.sort((a, b) => priority(b, rwyKey, atisInfo) - priority(a, rwyKey, atisInfo))

    const winner = group[0]
    for (let i = 1; i < group.length; i++) {
      const loser = group[i]
      result[loser.id] = false
      const winPri = priority(winner, rwyKey, atisInfo)
      const reason = winPri >= 100
        ? `ATIS prefers ${winner.name}`
        : `priority ${winner.name}>${loser.name} (I>R>H>L)`
      log.push({ kept: winner.name, suppressed: loser.name, reason })
    }
  }

  return [result, log]
}

/**
 * Pass 2 — parallel runways (I16L vs I16C vs I16R).
 *
 * When the same aircraft matches multiple approach procedures (because the
 * cross-track threshold overlaps adjacent parallel runways), assign each
 * aircraft to the procedure whose centreline it is physically closest to.
 * Procedures that end up with no remaining aircraft are suppressed.
 *
 * Returns [result, log].
 */
function deduplicateParallelApproaches(
  detected: Record<string, boolean>,
  detectedHexes: Record<string, string[]>,
  crossTrackNm: Record<string, Record<string, number>>,
  procedures: Procedure[],
): [Record<string, boolean>, Array<{ suppressed: string; reason: string }>] {
  const result = { ...detected }
  const log: Array<{ suppressed: string; reason: string }> = []

  const approachProcs = procedures.filter((p) => p.type === 'APPROACH' && result[p.id])

  const hexProcIds = new Map<string, Set<string>>()
  for (const proc of approachProcs) {
    for (const hex of detectedHexes[proc.id] ?? []) {
      if (!hexProcIds.has(hex)) hexProcIds.set(hex, new Set())
      hexProcIds.get(hex)!.add(proc.id)
    }
  }

  const removedFromProc = new Map<string, Set<string>>()
  const procById = new Map(procedures.map((p) => [p.id, p]))

  for (const [hex, procIds] of hexProcIds) {
    if (procIds.size <= 1) continue

    let minXt = Infinity
    let nearestProcId = ''
    for (const procId of procIds) {
      const xt = crossTrackNm[procId]?.[hex] ?? Infinity
      if (xt < minXt) { minXt = xt; nearestProcId = procId }
    }

    for (const procId of procIds) {
      if (procId === nearestProcId) continue
      if (!removedFromProc.has(procId)) removedFromProc.set(procId, new Set())
      removedFromProc.get(procId)!.add(hex)
    }
  }

  for (const proc of approachProcs) {
    const removed = removedFromProc.get(proc.id)
    if (!removed) continue
    const remaining = (detectedHexes[proc.id] ?? []).filter((h) => !removed.has(h))
    if (remaining.length === 0) {
      result[proc.id] = false
      // Find which procedure claimed the aircraft
      const claimedBy = [...(detectedHexes[proc.id] ?? [])]
        .map((h) => {
          const nearestId = [...(hexProcIds.get(h) ?? [])]
            .filter((id) => id !== proc.id)
            .sort((a, b) => (crossTrackNm[a]?.[h] ?? Infinity) - (crossTrackNm[b]?.[h] ?? Infinity))[0]
          return procById.get(nearestId ?? '')?.name ?? nearestId ?? '?'
        })
        .filter((v, i, a) => a.indexOf(v) === i)
      log.push({
        suppressed: proc.name,
        reason: `parallel rwy — all aircraft closer to ${claimedBy.join('/')}`,
      })
    }
  }

  return [result, log]
}

/** Resolve an aircraft hex to a display label (callsign → registration → hex). */
function acLabel(hex: string): string {
  const ac = useAircraftStore.getState().aircraftMap.get(hex)
  return ac ? (ac.flight?.trim() || ac.registration || hex.toUpperCase()) : hex.toUpperCase()
}

export function useProcedureDetection() {
  const lastPollMs = useAircraftStore((s) => s.lastPollMs)
  const selectedAirport = useAirportStore((s) => s.selectedAirport)
  const atisInfo = useAirportStore((s) => s.atisInfo)
  const procedures = useProcedureStore((s) => s.procedures)
  const updateAutoDetection = useProcedureStore((s) => s.updateAutoDetection)
  const altFilterMin = useSettingsStore((s) => s.altFilterMin)
  const altFilterMax = useSettingsStore((s) => s.altFilterMax)

  // Persists across polls: hex → Set<procId> seen on a pre-MAP segment.
  // Cleared when an aircraft leaves the tracked set.
  const preMapSeen = useRef<Map<string, Set<string>>>(new Map())

  // Reset when airport changes — stale pre-MAP state from a different airport
  // would allow departures to masquerade as missed approaches.
  const prevAirportRef = useRef<string | null>(null)
  useEffect(() => {
    const icao = selectedAirport?.icao ?? null
    if (icao !== prevAirportRef.current) {
      preMapSeen.current.clear()
      prevAirportRef.current = icao
    }
  }, [selectedAirport])

  useEffect(() => {
    if (!selectedAirport || procedures.length === 0 || lastPollMs === 0) return

    const minFt = positionToMinFt(altFilterMin)
    const maxFt = positionToMaxFt(altFilterMax)
    const aircraft = Array.from(useAircraftStore.getState().aircraftMap.values()).filter(
      (ac) =>
        ac.altBaro !== 'ground' &&
        (ac.altBaro as number) >= minFt &&
        (ac.altBaro as number) <= maxFt,
    )
    const now = Date.now()

    const result = detectProceduresInUse(
      aircraft,
      procedures,
      selectedAirport.lat,
      selectedAirport.lon,
      selectedAirport.elevation,
      now,
      preMapSeen.current,
    )

    // Prune pre-MAP entries for aircraft that have left the tracked area.
    const currentHexes = new Set(aircraft.map((ac) => ac.hex))
    for (const hex of preMapSeen.current.keys()) {
      if (!currentHexes.has(hex)) preMapSeen.current.delete(hex)
    }

    // Pass 1: same runway, competing types — keep only highest-priority (ATIS-informed)
    const [deduped1, dedupLog1] = deduplicateApproaches(result.detected, procedures, atisInfo)
    // Pass 2: parallel runways — assign each aircraft to the nearest centreline
    const [deduped2, dedupLog2] = deduplicateParallelApproaches(
      deduped1, result.detectedHexes, result.crossTrackNm, procedures,
    )

    // Hexes for the procedures that survived dedup (used for hover tooltips).
    const keptHexes: Record<string, string[]> = {}
    for (const [id, detected] of Object.entries(deduped2)) {
      if (detected) keptHexes[id] = result.detectedHexes[id] ?? []
    }

    // Any approach on the same runway as a current winner should be immediately
    // hidden — don't let it linger for the 5-minute grace period.
    const winnerRunways = new Set(
      procedures
        .filter((p) => p.type === 'APPROACH' && deduped2[p.id])
        .map(approachRunwayKey),
    )
    const immediateSuppress = new Set(
      procedures
        .filter((p) => p.type === 'APPROACH' && !deduped2[p.id] && winnerRunways.has(approachRunwayKey(p)))
        .map((p) => p.id),
    )

    updateAutoDetection(deduped2, now, keptHexes, immediateSuppress)

    // ── Debug logging ─────────────────────────────────────────────────────────
    const rawDetected = Object.entries(result.detected).filter(([, v]) => v).map(([id]) => id)
    if (rawDetected.length === 0) return

    const finalShown = Object.keys(keptHexes).filter((id) => deduped2[id])
    const totalSuppressed = dedupLog1.length + dedupLog2.length

    console.groupCollapsed(
      `[ProcDetect] ${selectedAirport.icao} — ${finalShown.length} shown, ${totalSuppressed} deduped, ${immediateSuppress.size} immediately hidden`,
    )

    if (finalShown.length > 0) {
      console.log('%cSHOWN', 'color:#4ade80;font-weight:bold')
      for (const id of finalShown) {
        const proc = procedures.find((p) => p.id === id)
        const hexes = keptHexes[id] ?? []
        const labels = hexes.map(acLabel)
        console.log(
          `  ${proc?.name ?? id}  [${proc?.type ?? '?'}]`,
          hexes.length > 0 ? `← ${labels.join(', ')}` : '(timing out — no current traffic)',
        )
      }
    }

    // SID/STAR detections (no per-aircraft hex tracking)
    const sidStarDetected = rawDetected.filter((id) => {
      const p = procedures.find((q) => q.id === id)
      return p && p.type !== 'APPROACH'
    })
    if (sidStarDetected.length > 0) {
      console.log('%cSID/STAR detected', 'color:#94a3b8')
      for (const id of sidStarDetected) {
        const proc = procedures.find((p) => p.id === id)
        console.log(`  ${proc?.name ?? id}  [${proc?.type ?? '?'}]`)
      }
    }

    if (dedupLog1.length > 0) {
      console.log('%cPass 1 dedup (same runway, competing types)', 'color:#fb923c;font-weight:bold')
      for (const entry of dedupLog1) {
        console.log(`  ✗ ${entry.suppressed}  →  ${entry.reason}`)
      }
    }

    if (dedupLog2.length > 0) {
      console.log('%cPass 2 dedup (parallel runways)', 'color:#fb923c;font-weight:bold')
      for (const entry of dedupLog2) {
        console.log(`  ✗ ${entry.suppressed}  →  ${entry.reason}`)
      }
    }

    if (immediateSuppress.size > 0) {
      console.log('%cImmediately hidden (loser on runway with active winner)', 'color:#f87171;font-weight:bold')
      for (const id of immediateSuppress) {
        const proc = procedures.find((p) => p.id === id)
        console.log(`  → ${proc?.name ?? id}`)
      }
    }

    console.groupEnd()
  }, [lastPollMs, selectedAirport, procedures, atisInfo, updateAutoDetection, altFilterMin, altFilterMax])
}
