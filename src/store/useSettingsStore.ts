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

  setPollInterval: (ms: number) => void
  setSearchRadius: (nm: number) => void
  toggleExtendedCenterlines: () => void
  setCenterlineLength: (nm: number) => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      searchRadiusNm: ADSBX_SEARCH_RADIUS_NM,
      showExtendedCenterlines: false,
      extendedCenterlineLengthNm: EXTENDED_CENTERLINE_LENGTH_NM,

      setPollInterval: (ms) => set({ pollIntervalMs: Math.max(1000, ms) }),
      setSearchRadius: (nm) => set({ searchRadiusNm: Math.max(10, Math.min(250, nm)) }),
      toggleExtendedCenterlines: () =>
        set((s) => ({ showExtendedCenterlines: !s.showExtendedCenterlines })),
      setCenterlineLength: (nm) =>
        set({ extendedCenterlineLengthNm: Math.max(1, Math.min(50, nm)) }),
    }),
    { name: 'approach-map-settings' },
  ),
)
