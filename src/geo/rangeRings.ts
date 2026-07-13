import * as turf from '@turf/turf'
import type { Feature, FeatureCollection, LineString } from 'geojson'
import { RING_ZOOM_BUCKETS } from '../config/constants'
import { dest } from './procedureShapes'

const RING_STEPS = 64

/**
 * Ring radii (nm) for the given map zoom: the first `RING_ZOOM_BUCKETS` entry
 * (walked in order) whose `minZoom` the zoom meets or exceeds. The last
 * bucket's `minZoom` is `-Infinity`, so this always resolves.
 */
export function ringRadiiForZoom(zoom: number): [number, number, number] {
  for (const bucket of RING_ZOOM_BUCKETS) {
    if (zoom >= bucket.minZoom) return bucket.radiiNm
  }
  /* istanbul ignore next -- unreachable: the last bucket always matches */
  return RING_ZOOM_BUCKETS[RING_ZOOM_BUCKETS.length - 1].radiiNm
}

/**
 * One closed LineString ring per radius, centered on the aircraft. Rings are
 * lines (not filled polygons) so `ProcedureLayer`-style consumers can style
 * them as thin circles without a fill layer.
 */
export function ringFeatures(
  lat: number,
  lon: number,
  radiiNm: [number, number, number],
): FeatureCollection<LineString, { radiusNm: number }> {
  const features: Feature<LineString, { radiusNm: number }>[] = radiiNm.map((radiusNm) => {
    const circle = turf.circle([lon, lat], radiusNm, { steps: RING_STEPS, units: 'nauticalmiles' })
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: circle.geometry.coordinates[0] },
      properties: { radiusNm },
    }
  })
  return { type: 'FeatureCollection', features }
}

export interface RingBadge {
  radiusNm: number
  lat: number
  lon: number
  position: '12' | '6'
}

/**
 * Badge anchor for each ring: the 12 o'clock point (bearing 0 from center at
 * `radiusNm`), unless the projected screen point is off the top of the
 * viewport (null project, or `y < viewportTopPx`) — then the 6 o'clock point
 * (bearing 180) is used instead so the "N NM" label always stays on-screen.
 */
export function ringBadges(
  lat: number,
  lon: number,
  radiiNm: [number, number, number],
  project: (lonLat: [number, number]) => { x: number; y: number } | null,
  viewportTopPx = 8,
): RingBadge[] {
  return radiiNm.map((radiusNm) => {
    const twelve = dest([lon, lat], radiusNm, 0)
    const projected = project(twelve)
    if (projected !== null && projected.y >= viewportTopPx) {
      return { radiusNm, lat: twelve[1], lon: twelve[0], position: '12' }
    }
    const six = dest([lon, lat], radiusNm, 180)
    return { radiusNm, lat: six[1], lon: six[0], position: '6' }
  })
}
