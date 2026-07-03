import { create } from 'zustand'
import type { Procedure } from '../types/procedure'

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

  setProcedures: (procedures: Procedure[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setUserToggle: (id: string, visible: boolean) => void
  revertToAuto: (id: string) => void
  updateAutoDetection: (
    detected: Record<string, boolean>,
    nowMs: number,
    hexes?: Record<string, string[]>,
    immediateSuppress?: ReadonlySet<string>,
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

  setProcedures: (procedures) =>
    set({
      procedures,
      userToggles: {},
      autoVisible: {},
      autoShownIds: new Set(),
      lastDetectedAt: {},
      detectedHexes: {},
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

  updateAutoDetection: (detected, nowMs, hexes = {}, immediateSuppress = new Set()) =>
    set((s) => {
      const autoVisible = { ...s.autoVisible }
      const lastDetectedAt = { ...s.lastDetectedAt }
      const autoShownIds = new Set(s.autoShownIds)

      for (const [id, isDetected] of Object.entries(detected)) {
        const userSet = s.userToggles[id] !== undefined
        if (isDetected) {
          lastDetectedAt[id] = nowMs
          if (!userSet && !autoVisible[id]) {
            autoVisible[id] = true
            autoShownIds.add(id)
          }
        } else if (autoShownIds.has(id) && !userSet) {
          if (immediateSuppress.has(id)) {
            // A winning approach is already active on this runway — hide now,
            // don't wait for the grace period.
            autoVisible[id] = false
            autoShownIds.delete(id)
          } else {
            const timeSinceSeen = nowMs - (lastDetectedAt[id] ?? 0)
            if (timeSinceSeen > 5 * 60 * 1000) {
              autoVisible[id] = false
              autoShownIds.delete(id)
            }
          }
        }
      }
      return { autoVisible, lastDetectedAt, autoShownIds, detectedHexes: hexes }
    }),

  isVisible: (id) => {
    const { userToggles, autoVisible } = get()
    const userToggle = userToggles[id]
    if (userToggle !== undefined) return userToggle
    return autoVisible[id] ?? false
  },
}))
