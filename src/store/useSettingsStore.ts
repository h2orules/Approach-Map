import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_POLL_INTERVAL_MS,
  ADSBX_SEARCH_RADIUS_NM,
  EXTENDED_CENTERLINE_LENGTH_NM,
} from '../config/constants'

interface SettingsStore {
  pollIntervalMs: number
  searchRadiusNm: number
  showExtendedCenterlines: boolean
  extendedCenterlineLengthNm: number
  showTerrain: boolean
  showSafeAltitudes: boolean
  showMva: boolean
  showAirspace: boolean
  /** Show radar-derived TIS-B targets (hex prefixed with '~'). */
  showTisb: boolean
  /** Show VFR traffic (squawking 1200). */
  showVfr: boolean
  /** Draw predicted-path lines ahead of moving aircraft. */
  showPredictedPaths: boolean
  /** How far ahead (minutes) the predicted path extends. */
  predictionMinutes: 1 | 2 | 3 | 5
  /** Draw range rings around the selected aircraft. */
  showRangeRings: boolean
  /** Slider position (0–19) for the lower altitude filter handle. */
  altFilterMin: number
  /** Slider position (0–19) for the upper altitude filter handle. */
  altFilterMax: number

  setPollInterval: (ms: number) => void
  setSearchRadius: (nm: number) => void
  toggleExtendedCenterlines: () => void
  setCenterlineLength: (nm: number) => void
  toggleTerrain: () => void
  toggleSafeAltitudes: () => void
  toggleMva: () => void
  toggleAirspace: () => void
  toggleTisb: () => void
  toggleVfr: () => void
  togglePredictedPaths: () => void
  setPredictionMinutes: (m: 1 | 2 | 3 | 5) => void
  toggleRangeRings: () => void
  setAltFilterMin: (pos: number) => void
  setAltFilterMax: (pos: number) => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      searchRadiusNm: ADSBX_SEARCH_RADIUS_NM,
      showExtendedCenterlines: false,
      extendedCenterlineLengthNm: EXTENDED_CENTERLINE_LENGTH_NM,
      showTerrain: false,
      showSafeAltitudes: false,
      showMva: false,
      showAirspace: false,
      showTisb: true,
      showVfr: true,
      showPredictedPaths: true,
      predictionMinutes: 3,
      showRangeRings: false,
      altFilterMin: 0,
      altFilterMax: 19,

      setPollInterval: (ms) => set({ pollIntervalMs: Math.max(1000, ms) }),
      setSearchRadius: (nm) => set({ searchRadiusNm: Math.max(10, Math.min(250, nm)) }),
      toggleExtendedCenterlines: () =>
        set((s) => ({ showExtendedCenterlines: !s.showExtendedCenterlines })),
      setCenterlineLength: (nm) =>
        set({ extendedCenterlineLengthNm: Math.max(1, Math.min(50, nm)) }),
      toggleTerrain: () => set((s) => ({ showTerrain: !s.showTerrain })),
      toggleSafeAltitudes: () => set((s) => ({ showSafeAltitudes: !s.showSafeAltitudes })),
      toggleMva: () => set((s) => ({ showMva: !s.showMva })),
      toggleAirspace: () => set((s) => ({ showAirspace: !s.showAirspace })),
      toggleTisb: () => set((s) => ({ showTisb: !s.showTisb })),
      toggleVfr: () => set((s) => ({ showVfr: !s.showVfr })),
      togglePredictedPaths: () => set((s) => ({ showPredictedPaths: !s.showPredictedPaths })),
      setPredictionMinutes: (m) => set({ predictionMinutes: m }),
      toggleRangeRings: () => set((s) => ({ showRangeRings: !s.showRangeRings })),
      setAltFilterMin: (pos) => set({ altFilterMin: Math.max(0, Math.min(19, pos)) }),
      setAltFilterMax: (pos) => set({ altFilterMax: Math.max(0, Math.min(19, pos)) }),
    }),
    { name: 'approach-map-settings' },
  ),
)
