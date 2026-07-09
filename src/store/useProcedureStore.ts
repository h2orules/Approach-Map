import { create } from 'zustand'
import type { Procedure } from '../types/procedure'
import type { ProcedureActivity } from '../geo/detectionMachine'
import { approachRunwayKey } from '../geo/approachPriority'
import { appendSamples, type DetectionSample } from '../utils/detectionHistory'
import { DETECTION_HISTORY_WINDOW_MS, AUTO_HIDE_DELAY_MS } from '../config/constants'

/**
 * The dual visibility rule: an explicit user toggle wins, otherwise the
 * auto-detection engine decides. Pure so callers that already subscribed to
 * `userToggles`/`autoVisible` (e.g. to build a render list) don't need a
 * second store subscription just to resolve one id — `isVisible` below
 * delegates here, keeping exactly one implementation.
 */
export function computeVisibility(
  userToggles: Record<string, boolean | undefined>,
  autoVisible: Record<string, boolean>,
  id: string,
): boolean {
  const userToggle = userToggles[id]
  if (userToggle !== undefined) return userToggle
  return autoVisible[id] ?? false
}

/** Same elements in the same order — used to preserve array identity across polls. */
function sameHexes(a: string[] | undefined, b: string[]): boolean {
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Ids of the currently-stored procedures owned by one airport (match by
 *  `proc.icao`, not fragile id-prefix parsing). */
function ownedIds(procedures: Procedure[], key: string): Set<string> {
  const K = key.toUpperCase()
  const ids = new Set<string>()
  for (const p of procedures) if (p.icao.toUpperCase() === K) ids.add(p.id)
  return ids
}

/** Copy of `map` with every entry whose key is in `ids` dropped. */
function pruneById<T>(map: Record<string, T>, ids: Set<string>): Record<string, T> {
  if (ids.size === 0) return map
  const next: Record<string, T> = {}
  for (const k of Object.keys(map)) if (!ids.has(k)) next[k] = map[k]
  return next
}

/**
 * Copy of `map` with every entry whose VALUE is in `ownedProcIds` dropped
 * (used for `aircraftAssignments`, keyed by hex, valued by procedure id).
 * Returns the original reference when nothing actually changes, so merging an
 * airport that owns no current assignments (the common case — e.g. adding a
 * brand-new airport) doesn't churn `aircraftAssignments`'s identity and
 * trigger unrelated subscribers (e.g. `useProfileProcedure`) to re-run.
 */
function pruneAssignmentsByProcId(
  map: Record<string, string>,
  ownedProcIds: Set<string>,
): Record<string, string> {
  if (ownedProcIds.size === 0) return map
  let changed = false
  const next: Record<string, string> = {}
  for (const [hex, procId] of Object.entries(map)) {
    if (ownedProcIds.has(procId)) changed = true
    else next[hex] = procId
  }
  return changed ? next : map
}

interface ProcedureStore {
  procedures: Procedure[]
  loading: boolean
  error: string | null

  // undefined = not set by user; true/false = explicit user choice
  userToggles: Record<string, boolean | undefined>
  // driven by auto-detection engine
  autoVisible: Record<string, boolean>
  // ids of procedures that were auto-shown (not user-initiated)
  autoShownIds: Set<string>
  // epoch ms of last detected aircraft per procedure
  lastDetectedAt: Record<string, number>
  // hex codes of aircraft currently matching each auto-detected approach
  detectedHexes: Record<string, string[]>
  // hex → assigned approach procId (exactly one approach per aircraft)
  aircraftAssignments: Record<string, string>
  // rolling window of detected-aircraft counts per procedure (see src/utils/detectionHistory.ts)
  detectionHistory: Record<string, DetectionSample[]>

  /**
   * Splice out one airport's rows (matched by `proc.icao`) and append the new
   * ones, preserving every OTHER airport's detection state and clearing only
   * the merged airport's per-id entries.
   */
  mergeAirportProcedures: (key: string, procs: Procedure[]) => void
  /** Drop one airport's procedures and all its per-id detection state. */
  removeAirportProcedures: (key: string) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setUserToggle: (id: string, visible: boolean) => void
  revertToAuto: (id: string) => void
  applyDetection: (
    activity: Record<string, ProcedureActivity>,
    assignments: Record<string, string>,
    nowMs: number,
  ) => void
  isVisible: (id: string) => boolean
}

export const useProcedureStore = create<ProcedureStore>((set, get) => ({
  procedures: [],
  loading: false,
  error: null,
  userToggles: {},
  autoVisible: {},
  autoShownIds: new Set(),
  lastDetectedAt: {},
  detectedHexes: {},
  aircraftAssignments: {},
  detectionHistory: {},

  mergeAirportProcedures: (key, procs) =>
    set((s) => {
      const owned = ownedIds(s.procedures, key)
      const procedures = s.procedures.filter((p) => !owned.has(p.id)).concat(procs)
      return {
        procedures,
        userToggles: pruneById(s.userToggles, owned),
        autoVisible: pruneById(s.autoVisible, owned),
        autoShownIds:
          owned.size === 0
            ? s.autoShownIds
            : new Set([...s.autoShownIds].filter((id) => !owned.has(id))),
        lastDetectedAt: pruneById(s.lastDetectedAt, owned),
        detectedHexes: pruneById(s.detectedHexes, owned),
        aircraftAssignments: pruneAssignmentsByProcId(s.aircraftAssignments, owned),
        detectionHistory: pruneById(s.detectionHistory, owned),
      }
    }),

  removeAirportProcedures: (key) =>
    set((s) => {
      const owned = ownedIds(s.procedures, key)
      if (owned.size === 0) return {}
      const procedures = s.procedures.filter((p) => !owned.has(p.id))
      return {
        procedures,
        userToggles: pruneById(s.userToggles, owned),
        autoVisible: pruneById(s.autoVisible, owned),
        autoShownIds: new Set([...s.autoShownIds].filter((id) => !owned.has(id))),
        lastDetectedAt: pruneById(s.lastDetectedAt, owned),
        detectedHexes: pruneById(s.detectedHexes, owned),
        aircraftAssignments: pruneAssignmentsByProcId(s.aircraftAssignments, owned),
        detectionHistory: pruneById(s.detectionHistory, owned),
      }
    }),

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  setUserToggle: (id, visible) =>
    set((s) => ({ userToggles: { ...s.userToggles, [id]: visible } })),

  revertToAuto: (id) =>
    set((s) => {
      const next = { ...s.userToggles }
      delete next[id]
      return { userToggles: next }
    }),

  applyDetection: (activity, assignments, nowMs) =>
    set((s) => {
      const autoVisible = { ...s.autoVisible }
      const lastDetectedAt = { ...s.lastDetectedAt }
      const autoShownIds = new Set(s.autoShownIds)

      // Approach runway keys that currently hold ≥1 active aircraft — used to
      // immediately hide a same-runway sibling that has lost all its traffic
      // (e.g. ATIS flips mid-session from ILS to RNAV on the same runway).
      const activeApproachRwys = new Set<string>()
      for (const proc of s.procedures) {
        if (proc.type === 'APPROACH' && (activity[proc.id]?.hexes.length ?? 0) > 0) {
          activeApproachRwys.add(approachRunwayKey(proc))
        }
      }

      for (const proc of s.procedures) {
        const id = proc.id
        const act = activity[id]
        const detected = (act?.hexes.length ?? 0) > 0
        const userSet = s.userToggles[id] !== undefined

        if (detected) {
          lastDetectedAt[id] = act!.lastActiveMs
          if (!userSet && !autoVisible[id]) {
            autoVisible[id] = true
            autoShownIds.add(id)
          }
        } else if (autoShownIds.has(id) && !userSet) {
          const siblingActive =
            proc.type === 'APPROACH' && activeApproachRwys.has(approachRunwayKey(proc))
          if (siblingActive) {
            autoVisible[id] = false
            autoShownIds.delete(id)
          } else if (nowMs - (lastDetectedAt[id] ?? 0) > AUTO_HIDE_DELAY_MS) {
            autoVisible[id] = false
            autoShownIds.delete(id)
          }
        }
      }

      // Detected-hex lists: only active procedures, preserving the previous
      // array reference when unchanged so subscribers don't needlessly re-render.
      const detectedHexes: Record<string, string[]> = {}
      for (const [id, act] of Object.entries(activity)) {
        detectedHexes[id] = sameHexes(s.detectedHexes[id], act.hexes) ? s.detectedHexes[id] : act.hexes
      }

      // Zero samples for previously-sampled procedures keep their rolling
      // average decaying once traffic leaves — otherwise a procedure that just
      // went idle would hold its last nonzero average for the whole window and
      // skew the safeAltitude sector ranking.
      const counts: Record<string, number> = {}
      for (const id of Object.keys(s.detectionHistory)) counts[id] = 0
      for (const [id, act] of Object.entries(activity)) counts[id] = act.hexes.length
      const detectionHistory = appendSamples(
        s.detectionHistory,
        counts,
        nowMs,
        DETECTION_HISTORY_WINDOW_MS,
      )

      return {
        autoVisible,
        lastDetectedAt,
        autoShownIds,
        detectedHexes,
        aircraftAssignments: assignments,
        detectionHistory,
      }
    }),

  isVisible: (id) => {
    const { userToggles, autoVisible } = get()
    return computeVisibility(userToggles, autoVisible, id)
  },
}))
