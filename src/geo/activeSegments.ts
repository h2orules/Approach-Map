import * as turf from '@turf/turf'
import type { Feature, LineString, FeatureCollection } from 'geojson'
import type { InterpolatedAircraft } from '../types/aircraft'
import type { Procedure } from '../types/procedure'
import { DIRECTION_TOLERANCE_DEG } from '../config/constants'

const MAX_OFFSET_NM = 2

function bearingDelta(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

/**
 * For each visible SID/STAR procedure, find every leg (segment between two
 * consecutive fixes) that at least one non-selected aircraft is actively flying.
 * Returns a GeoJSON FeatureCollection; each feature carries `color` (the
 * procedure's own color) for data-driven styling.
 *
 * Segments are deduped: multiple aircraft on the same leg produce one feature.
 */
export function findActiveSegments(
  aircraft: InterpolatedAircraft[],
  procedures: Procedure[],
  excludeHex: string | null,
): FeatureCollection {
  const features: Feature<LineString>[] = []
  const seen = new Set<string>()

  for (const proc of procedures) {
    const flyingAircraft = aircraft.filter(
      (ac) => ac.hex !== excludeHex && ac.altBaro !== 'ground',
    )
    if (flyingAircraft.length === 0) continue

    for (const feat of proc.geojson.features) {
      if (feat.geometry?.type !== 'LineString') continue
      const coords = feat.geometry.coordinates as [number, number][]
      if (coords.length < 2) continue

      const line = turf.lineString(coords)

      for (const ac of flyingAircraft) {
        const acPt = turf.point([ac.interpLon, ac.interpLat])
        const nearest = turf.nearestPointOnLine(line, acPt, { units: 'nauticalmiles' })
        const dist = nearest.properties.dist ?? Infinity
        if (dist > MAX_OFFSET_NM) continue

        const i = nearest.properties.index ?? 0
        const a = coords[i]
        const b = coords[Math.min(i + 1, coords.length - 1)]
        if (!a || !b || (a[0] === b[0] && a[1] === b[1])) continue

        const segBearing = turf.bearing(turf.point(a), turf.point(b))
        if (bearingDelta(ac.track, segBearing) > DIRECTION_TOLERANCE_DEG) continue

        // Dedup by procedure + feature index in GeoJSON + segment index.
        const key = `${proc.id}|${proc.geojson.features.indexOf(feat)}|${i}`
        if (seen.has(key)) break // another aircraft already claimed this segment
        seen.add(key)

        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [a, b] },
          properties: { color: proc.color },
        })
        break // one match per aircraft per feature is enough
      }
    }
  }

  return { type: 'FeatureCollection', features }
}
