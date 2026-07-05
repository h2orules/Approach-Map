import type { Feature, LineString, FeatureCollection } from 'geojson'
import type { InterpolatedAircraft } from '../types/aircraft'
import type { Procedure } from '../types/procedure'
import { DIRECTION_TOLERANCE_DEG } from '../config/constants'
import { matchPointToLine } from './lineMatching'

const MAX_OFFSET_NM = 2

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

      for (const ac of flyingAircraft) {
        const match = matchPointToLine(coords, ac.interpLat, ac.interpLon, ac.track, {
          maxCrossTrackNm: MAX_OFFSET_NM,
          directionToleranceDeg: DIRECTION_TOLERANCE_DEG,
        })
        if (!match) continue

        // Dedup by procedure + feature index in GeoJSON + segment index.
        const key = `${proc.id}|${proc.geojson.features.indexOf(feat)}|${match.segIdx}`
        if (seen.has(key)) break // another aircraft already claimed this segment
        seen.add(key)

        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [match.segStart, match.segEnd] },
          properties: { color: proc.color },
        })
        break // one match per aircraft per feature is enough
      }
    }
  }

  return { type: 'FeatureCollection', features }
}
