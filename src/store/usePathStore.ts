import { create } from 'zustand'
import type {
  PredictedPath,
  HoldEntryPrediction,
  AircraftAlert,
  ConflictPair,
} from '../types/path'

interface PathResults {
  /** Predicted path per aircraft hex. */
  predictions: Map<string, PredictedPath>
  /** Hold-entry prediction per aircraft hex. */
  holdEntries: Map<string, HoldEntryPrediction>
  /** Highest-priority alert per aircraft hex. */
  alerts: Map<string, AircraftAlert>
  conflictPairs: ConflictPair[]
  /** Hexes that must render even when the user's TIS-B/VFR/altitude filters
   * would hide them — aircraft involved in an active TA/RA. Cleared by the
   * same wholesale replacement as everything else once the alert resolves. */
  forcedVisibleHexes: Set<string>
}

interface PathState extends PathResults {
  /** Bumped once per setResults/clear — subscribe to this, not the Maps. */
  pathRevision: number
  setResults: (r: PathResults) => void
  clear: () => void
}

const emptyResults = (): PathResults => ({
  predictions: new Map(),
  holdEntries: new Map(),
  alerts: new Map(),
  conflictPairs: [],
  forcedVisibleHexes: new Set(),
})

export const usePathStore = create<PathState>((set) => ({
  ...emptyResults(),
  pathRevision: 0,

  // Wholesale replacement: the caller passes fresh collections each cycle, so
  // stale hexes disappear by construction rather than needing pruning here.
  setResults: (r) => set((s) => ({ ...r, pathRevision: s.pathRevision + 1 })),

  clear: () => set((s) => ({ ...emptyResults(), pathRevision: s.pathRevision + 1 })),
}))
