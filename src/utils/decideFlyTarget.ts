import type { Airport } from '../types/airport'
import { airportKey } from '../store/useAirportStore'

export interface FlyTarget {
  lat: number
  lon: number
  zoom: number
}

const DEFAULT_FLY_ZOOM = 11

/**
 * Decide whether selecting/adding `added` should move the camera.
 *
 * The camera anchors on the PRIMARY airport (activeAirports[0]). We fly only
 * when `added` becomes or refreshes that anchor:
 *   - the first airport (empty `currentAirports`), or
 *   - an explicit re-select of the current primary (recenter on it).
 * Adding a 2nd+ airport returns null, so the camera stays put on the primary.
 *
 * Phase 4's single-select flow replaces the whole active set on every
 * selection, so `AirportSearch` passes an empty `currentAirports` — the added
 * airport is always the primary, preserving the always-recenter UX. Phase 5's
 * multi-airport add flow will pass the real pre-add list so subsequent airports
 * don't yank the camera.
 */
export function decideFlyTarget(currentAirports: Airport[], added: Airport): FlyTarget | null {
  const isFirst = currentAirports.length === 0
  const isPrimaryReselect =
    currentAirports.length > 0 && airportKey(currentAirports[0]) === airportKey(added)
  if (isFirst || isPrimaryReselect) {
    return { lat: added.lat, lon: added.lon, zoom: DEFAULT_FLY_ZOOM }
  }
  return null
}
