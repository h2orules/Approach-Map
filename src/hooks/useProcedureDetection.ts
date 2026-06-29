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
  // Primary: runway digits+direction encoded in the name (I34L → 34L)
  const m = proc.name.match(/^[A-Z](\d{2}[LRC]?)/)
  if (m) return m[1]
  // Fallback: runway set from parsed CIFP transitions
  return [...proc.runways].sort().join(',')
}

/**
 * When several approaches to the same runway are all detected, suppress lower-
 * priority ones unless they have at least one aircraft not already accounted
 * for by a higher-priority approach.  Priority order: I > R > H > L.
 */
function deduplicateApproaches(
  detected: Record<string, boolean>,
  detectedHexes: Record<string, string[]>,
  procedures: Procedure[],
): Record<string, boolean> {
  const result = { ...detected }

  // Group detected approaches by runway (extracted from procedure name).
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

    // Sort highest priority first.
    group.sort((a, b) => approachPriority(b) - approachPriority(a))

    const claimed = new Set<string>()
    for (const proc of group) {
      const myHexes = detectedHexes[proc.id] ?? []
      if (claimed.size === 0) {
        // Highest-priority: always keep, claim its aircraft.
        for (const h of myHexes) claimed.add(h)
      } else {
        const uniqueHexes = myHexes.filter((h) => !claimed.has(h))
        if (uniqueHexes.length > 0) {
          // Has aircraft not covered by any higher-priority approach: keep.
          for (const h of myHexes) claimed.add(h)
        } else {
          // Fully redundant: suppress.
          result[proc.id] = false
        }
      }
    }
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

    const deduped = deduplicateApproaches(result.detected, result.detectedHexes, procedures)
    updateAutoDetection(deduped, now)
  }, [lastPollMs, selectedAirport, procedures, updateAutoDetection])
}
