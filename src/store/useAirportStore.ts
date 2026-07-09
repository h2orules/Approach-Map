import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Airport, Runway } from '../types/airport'
import type { AtisInfo } from '../api/datis'
import { MAX_ACTIVE_AIRPORTS } from '../config/constants'

/**
 * Canonical identity for an airport: its data `key`, or the ICAO (they are
 * equal for LID-only fields, where `icao` is set to `key`). Uppercased so
 * lookups against CIFP `proc.icao` (always uppercase) match. Every per-airport
 * map in this store (`runwaysByIcao`, `atisByIcao`) is keyed by this value.
 */
export function airportKey(a: Airport): string {
  return (a.key ?? a.icao).toUpperCase()
}

/** Result of `addAirport`, so the UI can distinguish a no-op from the cap. */
export type AddAirportResult = 'added' | 'exists' | 'capped'

function flattenRunways(active: Airport[], byIcao: Record<string, Runway[]>): Runway[] {
  const out: Runway[] = []
  for (const a of active) {
    const rw = byIcao[airportKey(a)]
    if (rw) out.push(...rw)
  }
  return out
}

/**
 * Back-compat mirror fields derived from the multi-airport source of truth.
 * `selectedAirport`, `runways`, and `atisInfo` are kept exactly in sync with
 * `activeAirports[0]` and the per-airport maps so the pervasive
 * `(s) => s.selectedAirport` / `s.runways` / `s.atisInfo` reads across the
 * codebase keep working with correct reference identity and no churn. Detection,
 * ATIS polling, and the ADS-B poll stay primary-airport-only until Phase 6;
 * `runways` intentionally flattens across ALL active airports so every airport's
 * runways render.
 */
function computeMirrors(
  active: Airport[],
  runwaysByIcao: Record<string, Runway[]>,
  atisByIcao: Record<string, AtisInfo | null>,
): { selectedAirport: Airport | null; runways: Runway[]; atisInfo: AtisInfo | null } {
  const primary = active[0] ?? null
  return {
    selectedAirport: primary,
    runways: flattenRunways(active, runwaysByIcao),
    atisInfo: primary ? atisByIcao[airportKey(primary)] ?? null : null,
  }
}

interface AirportStore {
  /** Ordered; index 0 is the primary / camera anchor. */
  activeAirports: Airport[]
  runwaysByIcao: Record<string, Runway[]>
  atisByIcao: Record<string, AtisInfo | null>

  // ── Derived mirrors (see computeMirrors) — do not set directly ──
  selectedAirport: Airport | null
  runways: Runway[]
  atisInfo: AtisInfo | null

  loading: boolean

  /** Idempotent by key; enforces the hard cap. */
  addAirport: (a: Airport) => AddAirportResult
  removeAirport: (key: string) => void
  /** Replace the whole active list (persistence rehydrate / bulk set). */
  setActiveAirports: (list: Airport[]) => void
  /** Single-select wrapper: replace all with `[a]` (or clear). */
  setSelectedAirport: (a: Airport | null) => void
  setRunwaysForAirport: (key: string, runways: Runway[]) => void
  setAtisForAirport: (key: string, info: AtisInfo | null) => void
  setLoading: (loading: boolean) => void
}

export const useAirportStore = create<AirportStore>()(
  persist(
    (set, get) => ({
      activeAirports: [],
      runwaysByIcao: {},
      atisByIcao: {},

      selectedAirport: null,
      runways: [],
      atisInfo: null,
      loading: false,

      addAirport: (a) => {
        const key = airportKey(a)
        const { activeAirports, runwaysByIcao, atisByIcao } = get()
        if (activeAirports.some((x) => airportKey(x) === key)) return 'exists'
        if (activeAirports.length >= MAX_ACTIVE_AIRPORTS) return 'capped'
        const next = [...activeAirports, a]
        set({ activeAirports: next, ...computeMirrors(next, runwaysByIcao, atisByIcao) })
        return 'added'
      },

      removeAirport: (key) => {
        const K = key.toUpperCase()
        const { activeAirports, runwaysByIcao, atisByIcao } = get()
        const next = activeAirports.filter((x) => airportKey(x) !== K)
        if (next.length === activeAirports.length) return
        const nextRunways = { ...runwaysByIcao }
        delete nextRunways[K]
        const nextAtis = { ...atisByIcao }
        delete nextAtis[K]
        set({
          activeAirports: next,
          runwaysByIcao: nextRunways,
          atisByIcao: nextAtis,
          ...computeMirrors(next, nextRunways, nextAtis),
        })
      },

      setActiveAirports: (list) => {
        const { runwaysByIcao, atisByIcao } = get()
        set({ activeAirports: list, ...computeMirrors(list, runwaysByIcao, atisByIcao) })
      },

      setSelectedAirport: (a) => {
        const list = a ? [a] : []
        const { runwaysByIcao, atisByIcao } = get()
        set({ activeAirports: list, ...computeMirrors(list, runwaysByIcao, atisByIcao) })
      },

      setRunwaysForAirport: (key, runways) => {
        const K = key.toUpperCase()
        const { activeAirports, runwaysByIcao } = get()
        const next = { ...runwaysByIcao, [K]: runways }
        set({ runwaysByIcao: next, runways: flattenRunways(activeAirports, next) })
      },

      setAtisForAirport: (key, info) => {
        const K = key.toUpperCase()
        const { activeAirports, atisByIcao } = get()
        const next = { ...atisByIcao, [K]: info }
        const primary = activeAirports[0] ?? null
        set({ atisByIcao: next, atisInfo: primary ? next[airportKey(primary)] ?? null : null })
      },

      setLoading: (loading) => set({ loading }),
    }),
    {
      name: 'approach-map-airport',
      version: 1,
      // Only the active airport list persists; runways and ATIS reload on select.
      partialize: (s) => ({ activeAirports: s.activeAirports }),
      // v0 stored a single `{ selectedAirport }`; lift it into a one-element list.
      migrate: (persisted, version) => {
        if (version === 0 && persisted && typeof persisted === 'object') {
          const old = persisted as { selectedAirport?: Airport | null }
          return { activeAirports: old.selectedAirport ? [old.selectedAirport] : [] }
        }
        return persisted as { activeAirports: Airport[] }
      },
      // Recompute the derived mirrors from the rehydrated list (the persisted
      // payload only carries `activeAirports`).
      merge: (persisted, current) => {
        const active = ((persisted as { activeAirports?: Airport[] } | undefined)?.activeAirports ?? []) as Airport[]
        return {
          ...current,
          activeAirports: active,
          ...computeMirrors(active, current.runwaysByIcao, current.atisByIcao),
        }
      },
    },
  ),
)
