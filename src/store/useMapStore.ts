import { create } from 'zustand'
import { MAP_STYLES, DEFAULT_MAP_CENTER } from '../config/constants'
import { applyAxisZoomDelta, type ZoomAxis } from '../utils/axisZoom'

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
  /**
   * Anisotropic zoom: zoomY - zoomX in zoom levels (0 = normal 1:1).
   * `viewport.zoom` is always the LESS zoomed axis; the other axis is
   * produced by CSS-stretching the map frame (AxisStretchFrame). Session-only
   * by design — restoring a stretched map on reload would be disorienting.
   * See src/utils/axisZoom.ts for the math.
   */
  axisRatio: number

  setViewport: (v: Partial<ViewState>) => void
  setTheme: (t: MapTheme) => void
  toggleSatellite: () => void
  getMapStyle: () => string
  requestResize: () => void
  setHoveredAirportKey: (k: string | null) => void
  /** Zoom one axis in/out by `delta` levels, leaving the other axis as-is. */
  adjustAxisZoom: (axis: ZoomAxis, delta: number) => void
  /** Back to 1:1 — the less-zoomed axis's scale is kept. */
  resetAxisZoom: () => void
}

export const useMapStore = create<MapStore>((set, get) => ({
  viewport: DEFAULT_MAP_CENTER,
  theme: 'dark',
  styleKey: 'dark',
  satelliteOn: false,
  resizeToken: 0,
  hoveredAirportKey: null,
  axisRatio: 0,

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

  adjustAxisZoom: (axis, delta) =>
    set((s) => {
      const next = applyAxisZoomDelta({ zoom: s.viewport.zoom, axisRatio: s.axisRatio }, axis, delta)
      return { axisRatio: next.axisRatio, viewport: { ...s.viewport, zoom: next.zoom } }
    }),

  resetAxisZoom: () => set({ axisRatio: 0 }),
}))
