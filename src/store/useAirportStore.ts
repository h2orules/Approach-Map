import { create } from 'zustand'
import type { Airport, Runway } from '../types/airport'

interface AirportStore {
  selectedAirport: Airport | null
  runways: Runway[]
  loading: boolean

  setSelectedAirport: (airport: Airport | null) => void
  setRunways: (runways: Runway[]) => void
  setLoading: (loading: boolean) => void
}

export const useAirportStore = create<AirportStore>((set) => ({
  selectedAirport: null,
  runways: [],
  loading: false,

  setSelectedAirport: (airport) => set({ selectedAirport: airport }),
  setRunways: (runways) => set({ runways }),
  setLoading: (loading) => set({ loading }),
}))
