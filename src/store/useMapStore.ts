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
  /**
   * Bumped by `requestResize()` to signal AppMap's mapbox instance to call
   * `.resize()` — there's no direct DOM ref from the sidebar to the map, so
   * this is the "ref-based resize()" seam: the sidebar (on collapse/expand
   * transitionend + a safety timeout) requests a resize, and AppMap's effect
   * keyed on this counter performs it.
   */
  resizeToken: number
  /**
   * Airport key currently hovered in the sidebar (an AirportSection header),
   * or null. Set on enter/leave only — no mousemove churn — so the map's
   * AirportLabelsLayer can highlight the matching ident label.
   */
  hoveredAirportKey: string | null

  setViewport: (v: Partial<ViewState>) => void
  setTheme: (t: MapTheme) => void
  toggleSatellite: () => void
  getMapStyle: () => string
  requestResize: () => void
  setHoveredAirportKey: (k: string | null) => void
}

export const useMapStore = create<MapStore>((set, get) => ({
  viewport: DEFAULT_MAP_CENTER,
  theme: 'dark',
  styleKey: 'dark',
  satelliteOn: false,
  resizeToken: 0,
  hoveredAirportKey: null,

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

  requestResize: () => set((s) => ({ resizeToken: s.resizeToken + 1 })),

  setHoveredAirportKey: (k) => set({ hoveredAirportKey: k }),
}))
