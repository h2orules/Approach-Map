import type { Feature, LineString, FeatureCollection } from 'geojson'
import type { InterpolatedAircraft } from '../types/aircraft'
import type { Procedure } from '../types/procedure'
import { DIRECTION_TOLERANCE_DEG, HOLD_MATCH_XT_NM, HOLD_MATCH_DIR_DEG } from '../config/constants'
import { matchPointToLine } from './lineMatching'

const MAX_OFFSET_NM = 2

/**
 * For each visible SID/STAR procedure — and for the *feeder* legs and *holds*
 * of each visible APPROACH — find the geometry that at least one aircraft is
 * actively flying. Returns a GeoJSON FeatureCollection; each feature carries
 * `color` (the procedure's own color) for data-driven styling.
 *
 * Approaches draw their feeder transitions thin and holds at an intermediate
 * weight by default (ProcedureLayer), so those need an active-flight thickening
 * here; the final segment keeps its own detection-driven width. SID/STAR legs
 * are all thin-by-default, so every leg is eligible.
 *
 * A hold thickens as a *whole racetrack* (not one leg) when an aircraft is
 * flying it, matched with the generous hold tolerances (HOLD_MATCH_*). Holds
 * are checked against every airborne aircraft including the selected one — a
 * hold in use should read regardless of selection — whereas per-leg highlights
 * exclude the selected aircraft (its leg is drawn by FlownSegmentLayer).
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
    const airborne = aircraft.filter((ac) => ac.altBaro !== 'ground')
    if (airborne.length === 0) continue
    const nonSelected = airborne.filter((ac) => ac.hex !== excludeHex)

    for (let fi = 0; fi < proc.geojson.features.length; fi++) {
      const feat = proc.geojson.features[fi]
      if (feat.geometry?.type !== 'LineString') continue
      const coords = feat.geometry.coordinates as [number, number][]
      const isHold = feat.properties?.kind === 'hold'

      if (isHold) {
        // Whole racetrack thickens when any airborne aircraft is flying it.
        const flying = airborne.some(
          (ac) =>
            matchPointToLine(coords, ac.interpLat, ac.interpLon, ac.track, {
              maxCrossTrackNm: HOLD_MATCH_XT_NM,
              directionToleranceDeg: HOLD_MATCH_DIR_DEG,
            }) !== null,
        )
        if (!flying) continue
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { color: proc.color },
        })
        continue
      }

      // Approaches: only the thin feeder legs are eligible for leg thickening.
      if (proc.type === 'APPROACH' && feat.properties?.feeder !== true) continue

      for (const ac of nonSelected) {
        const match = matchPointToLine(coords, ac.interpLat, ac.interpLon, ac.track, {
          maxCrossTrackNm: MAX_OFFSET_NM,
          directionToleranceDeg: DIRECTION_TOLERANCE_DEG,
          rejectZeroLength: true,
        })
        if (!match) continue

        // Dedup by procedure + feature index in GeoJSON + segment index.
        const key = `${proc.id}|${fi}|${match.segIdx}`
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
