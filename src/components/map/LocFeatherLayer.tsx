import { useMemo } from 'react'
import { Source, Layer } from 'react-map-gl'
import type { FeatureCollection, Feature, Polygon, LineString } from 'geojson'
import * as turf from '@turf/turf'
import type { Procedure } from '../../types/procedure'
import type { Runway, RunwayEnd } from '../../types/airport'
import { useSelectionStore } from '../../store/useSelectionStore'
import { useProcedureStore } from '../../store/useProcedureStore'
import { useAirportStore } from '../../store/useAirportStore'
import { useProfileProcedure } from '../../hooks/useProfileProcedure'
import { buildLocFeather } from '../../geo/locFeather'
import { LOC_FEATHER_LENGTH_NM, LOC_FEATHER_WIDTH_NM, LOC_FEATHER_COLOR } from '../../config/constants'

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** LOC-based approach naming: first letter of the procedure name — I=ILS, L=LOC, X=LDA. */
function isLocBased(procedure: Procedure): boolean {
  return ['I', 'L', 'X'].includes(procedure.name[0]?.toUpperCase())
}

/**
 * Coordinates of the final-approach FAF: the `role === 'faf'` leg of the
 * transition that also contains the missed-approach point (the final segment).
 * Null when the procedure has no such leg (e.g. legacy cached data with no
 * transitions, or an approach with no charted FAF).
 */
function findFafFix(procedure: Procedure): { lat: number; lon: number } | null {
  for (const t of procedure.transitions ?? []) {
    const faf = t.legs.find((l) => l.role === 'faf')
    const hasMap = t.legs.some((l) => l.role === 'map')
    if (faf && hasMap) return { lat: faf.lat, lon: faf.lon }
  }
  return null
}

/** Find the runway end (and its opposite end) whose id matches the approach's runway ident. */
function findRunwayEnd(
  runways: Runway[],
  runwayId: string,
): { end: RunwayEnd; other: RunwayEnd } | null {
  for (const rwy of runways) {
    if (rwy.lowEnd?.id === runwayId) return { end: rwy.lowEnd, other: rwy.highEnd }
    if (rwy.highEnd?.id === runwayId) return { end: rwy.highEnd, other: rwy.lowEnd }
  }
  return null
}

export function LocFeatherLayer() {
  const selected = useSelectionStore((s) => s.selected)
  const procedures = useProcedureStore((s) => s.procedures)
  const runways = useAirportStore((s) => s.runways)

  // When an aircraft is selected, reuse the same procedure resolution the
  // profile panel uses (visible approach whose detectedHexes includes it).
  const profileProcedure = useProfileProcedure()

  const procedure = useMemo<Procedure | null>(() => {
    if (selected?.kind === 'approach') {
      return procedures.find((p) => p.id === selected.procedureId && p.type === 'APPROACH') ?? null
    }
    if (selected?.kind === 'aircraft') {
      return profileProcedure
    }
    return null
  }, [selected, procedures, profileProcedure])

  const geojson = useMemo<FeatureCollection>(() => {
    if (!procedure || !isLocBased(procedure)) return EMPTY_FC

    const runwayId = procedure.runways[0]
    if (!runwayId) return EMPTY_FC

    const match = findRunwayEnd(runways, runwayId)
    if (!match) return EMPTY_FC
    const { end, other } = match
    if (!end?.lat || !other?.lat) return EMPTY_FC

    // True inbound landing course toward `end`. Prefer the course AS FLOWN — the
    // bearing from the FAF to the landing threshold — so the feather lies along
    // the actual final-approach course (which may be offset a few degrees from
    // the runway axis, as on a LOC or LDA). Fall back to the runway-axis bearing
    // (threshold → far end, the rollout/travel direction, which equals the
    // landing course — not its reciprocal) when the procedure has no charted FAF
    // leg. Derived from coordinates (like extendedCenterline.ts) so we don't
    // depend on the (possibly magnetic) published heading field. buildLocFeather
    // extends the feather outbound from here into the final-approach airspace
    // (the front-course side); passing the reciprocal would flip it to the back
    // course, over the runway.
    const faf = findFafFix(procedure)
    const axisBearing = faf
      ? turf.bearing(turf.point([faf.lon, faf.lat]), turf.point([end.lon, end.lat]))
      : turf.bearing(turf.point([end.lon, end.lat]), turf.point([other.lon, other.lat]))
    const inboundCourseTrueDeg = (axisBearing + 360) % 360

    const { shaded, outline } = buildLocFeather(
      end.lat,
      end.lon,
      inboundCourseTrueDeg,
      LOC_FEATHER_LENGTH_NM,
      LOC_FEATHER_WIDTH_NM,
    )

    const features: Feature[] = []
    for (const ring of shaded) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] } as Polygon,
        properties: { part: 'shaded' },
      })
    }
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: outline } as LineString,
      properties: { part: 'outline' },
    })

    return { type: 'FeatureCollection', features }
  }, [procedure, runways])

  return (
    <Source id="loc-feather" type="geojson" data={geojson}>
      <Layer
        id="loc-feather-fill"
        type="fill"
        filter={['==', ['geometry-type'], 'Polygon']}
        paint={{
          'fill-color': LOC_FEATHER_COLOR,
          'fill-opacity': 0.35,
        }}
      />
      <Layer
        id="loc-feather-outline"
        type="line"
        filter={['==', ['geometry-type'], 'LineString']}
        paint={{
          'line-color': LOC_FEATHER_COLOR,
          'line-width': 1,
        }}
      />
    </Source>
  )
}
