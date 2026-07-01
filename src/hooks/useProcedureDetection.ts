import { useEffect } from 'react'
import { useAircraftStore } from '../store/useAircraftStore'
import { useProcedureStore } from '../store/useProcedureStore'
import { useAirportStore } from '../store/useAirportStore'
import { detectProceduresInUse } from '../geo/procedureDetection'
import type { Procedure } from '../types/procedure'

// Approach type prefix → display priority (higher = preferred, shown on top).
const APPROACH_TYPE_PRIORITY: Record<string, number> = { I: 4, R: 3, H: 2, L: 1 }

function approachPriority(proc: Procedure): number {
  if (proc.type !== 'APPROACH') return -1
  return APPROACH_TYPE_PRIORITY[proc.name[0]?.toUpperCase()] ?? 0
}

/**
 * Extract the runway designator from an approach procedure name.
 * CIFP names are like I34L, R34C, H16R, L28, VDME-A.
 * Returns e.g. "34L", "16R", or "" for non-runway-specific approaches.
 */
function approachRunwayKey(proc: Procedure): string {
  const m = proc.name.match(/^[A-Z](\d{2}[LRC]?)/)
  if (m) return m[1]
  return [...proc.runways].sort().join(',')
}

/**
 * Pass 1 — same runway, competing types (I vs R vs H vs L on the same runway).
 * Suppress lower-priority approaches unless they have at least one aircraft not
 * already accounted for by a higher-priority approach.
 */
function deduplicateApproaches(
  detected: Record<string, boolean>,
  detectedHexes: Record<string, string[]>,
  procedures: Procedure[],
): Record<string, boolean> {
  const result = { ...detected }

  const approachProcs = procedures.filter((p) => p.type === 'APPROACH' && result[p.id])
  const byRunway = new Map<string, Procedure[]>()
  for (const proc of approachProcs) {
    const key = approachRunwayKey(proc)
    if (!key) continue
    const group = byRunway.get(key) ?? []
    if (!group.includes(proc)) group.push(proc)
    byRunway.set(key, group)
  }

  for (const group of byRunway.values()) {
    if (group.length <= 1) continue
    group.sort((a, b) => approachPriority(b) - approachPriority(a))

    const claimed = new Set<string>()
    for (const proc of group) {
      const myHexes = detectedHexes[proc.id] ?? []
      if (claimed.size === 0) {
        for (const h of myHexes) claimed.add(h)
      } else {
        const uniqueHexes = myHexes.filter((h) => !claimed.has(h))
        if (uniqueHexes.length > 0) {
          for (const h of myHexes) claimed.add(h)
        } else {
          result[proc.id] = false
        }
      }
    }
  }

  return result
}

/**
 * Pass 2 — parallel runways (I16L vs I16C vs I16R).
 *
 * When the same aircraft matches multiple approach procedures (because the
 * cross-track threshold overlaps adjacent parallel runways), assign each
 * aircraft to the procedure whose centreline it is physically closest to.
 * Procedures that end up with no remaining aircraft are suppressed.
 */
function deduplicateParallelApproaches(
  detected: Record<string, boolean>,
  detectedHexes: Record<string, string[]>,
  crossTrackNm: Record<string, Record<string, number>>,
  procedures: Procedure[],
): Record<string, boolean> {
  const result = { ...detected }

  const approachProcs = procedures.filter((p) => p.type === 'APPROACH' && result[p.id])

  // Build hex → [procIds it matched] map.
  const hexProcIds = new Map<string, Set<string>>()
  for (const proc of approachProcs) {
    for (const hex of detectedHexes[proc.id] ?? []) {
      if (!hexProcIds.has(hex)) hexProcIds.set(hex, new Set())
      hexProcIds.get(hex)!.add(proc.id)
    }
  }

  // For each hex that matched 2+ procedures, find the nearest and remove it
  // from the others.
  const removedFromProc = new Map<string, Set<string>>()
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

  // Suppress any approach whose aircraft set is now entirely claimed by closer procedures.
  for (const proc of approachProcs) {
    const removed = removedFromProc.get(proc.id)
    if (!removed) continue
    const remaining = (detectedHexes[proc.id] ?? []).filter((h) => !removed.has(h))
    if (remaining.length === 0) result[proc.id] = false
  }

  return result
}

export function useProcedureDetection() {
  const lastPollMs = useAircraftStore((s) => s.lastPollMs)
  const selectedAirport = useAirportStore((s) => s.selectedAirport)
  const procedures = useProcedureStore((s) => s.procedures)
  const updateAutoDetection = useProcedureStore((s) => s.updateAutoDetection)

  useEffect(() => {
    if (!selectedAirport || procedures.length === 0 || lastPollMs === 0) return

    const aircraft = Array.from(useAircraftStore.getState().aircraftMap.values())
    const now = Date.now()

    const result = detectProceduresInUse(
      aircraft,
      procedures,
      selectedAirport.lat,
      selectedAirport.lon,
      selectedAirport.elevation,
      now,
    )

    // Pass 1: same runway, competing types (I vs R vs H vs L)
    const deduped1 = deduplicateApproaches(result.detected, result.detectedHexes, procedures)
    // Pass 2: parallel runways — assign each aircraft to the nearest procedure
    const deduped2 = deduplicateParallelApproaches(deduped1, result.detectedHexes, result.crossTrackNm, procedures)

    updateAutoDetection(deduped2, now)
  }, [lastPollMs, selectedAirport, procedures, updateAutoDetection])
}
