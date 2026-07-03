import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Airport, Runway } from '../types/airport'
import type { AtisInfo } from '../api/datis'

interface AirportStore {
  selectedAirport: Airport | null
  runways: Runway[]
  loading: boolean
  atisInfo: AtisInfo | null

  setSelectedAirport: (airport: Airport | null) => void
  setRunways: (runways: Runway[]) => void
  setLoading: (loading: boolean) => void
  setAtisInfo: (info: AtisInfo | null) => void
}

export const useAirportStore = create<AirportStore>()(
  persist(
    (set) => ({
      selectedAirport: null,
      runways: [],
      loading: false,
      atisInfo: null,

      setSelectedAirport: (airport) => set({ selectedAirport: airport }),
      setRunways: (runways) => set({ runways }),
      setLoading: (loading) => set({ loading }),
      setAtisInfo: (info) => set({ atisInfo: info }),
    }),
    {
      name: 'approach-map-airport',
      // Only the chosen airport persists; runways and ATIS are reloaded on selection.
      partialize: (s) => ({ selectedAirport: s.selectedAirport }),
    },
  ),
)
