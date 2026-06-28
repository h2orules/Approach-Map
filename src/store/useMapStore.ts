import { create } from 'zustand'
import { MAP_STYLES, DEFAULT_MAP_CENTER } from '../config/constants'

export type MapTheme = 'light' | 'dark'
export type MapStyleKey = 'light' | 'dark' | 'satellite'

interface ViewState {
  longitude: number
  latitude: number
  zoom: number
}

interface MapStore {
  viewport: ViewState
  theme: MapTheme
  styleKey: MapStyleKey
  satelliteOn: boolean

  setViewport: (v: Partial<ViewState>) => void
  setTheme: (t: MapTheme) => void
  toggleSatellite: () => void
  getMapStyle: () => string
}

export const useMapStore = create<MapStore>((set, get) => ({
  viewport: DEFAULT_MAP_CENTER,
  theme: 'dark',
  styleKey: 'dark',
  satelliteOn: false,

  setViewport: (v) => set((s) => ({ viewport: { ...s.viewport, ...v } })),

  setTheme: (t) =>
    set((s) => ({
      theme: t,
      styleKey: s.satelliteOn ? 'satellite' : t,
    })),

  toggleSatellite: () =>
    set((s) => {
      const sat = !s.satelliteOn
      return { satelliteOn: sat, styleKey: sat ? 'satellite' : s.theme }
    }),

  getMapStyle: () => {
    const { styleKey } = get()
    return MAP_STYLES[styleKey]
  },
}))
