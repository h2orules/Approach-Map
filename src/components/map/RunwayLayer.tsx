import { useMemo } from 'react'
import { Source, Layer } from 'react-map-gl'
import type { FeatureCollection, Feature, Polygon } from 'geojson'
import * as turf from '@turf/turf'
import type { Runway } from '../../types/airport'
import { RUNWAY_FILL_COLOR } from '../../utils/colorScheme'

interface Props {
  runways: Runway[]
}

function buildRunwayPolygon(runway: Runway): Feature<Polygon> | null {
  const { lowEnd, highEnd, widthFt } = runway
  if (!lowEnd?.lat || !highEnd?.lat) return null

  const widthNm = widthFt / 6076.12

  const centerLine = turf.lineString([
    [lowEnd.lon, lowEnd.lat],
    [highEnd.lon, highEnd.lat],
  ])

  const poly = turf.buffer(centerLine, widthNm / 2, { units: 'nauticalmiles' })
  if (!poly) return null

  return poly as Feature<Polygon>
}

export function RunwayLayer({ runways }: Props) {
  const geojson = useMemo<FeatureCollection<Polygon>>(() => {
    const features: Feature<Polygon>[] = runways
      .map(buildRunwayPolygon)
      .filter((f): f is Feature<Polygon> => f !== null)
    return { type: 'FeatureCollection', features }
  }, [runways])

  if (runways.length === 0) return null

  return (
    <Source id="runways" type="geojson" data={geojson}>
      <Layer
        id="runway-fill"
        type="fill"
        paint={{
          'fill-color': RUNWAY_FILL_COLOR,
          'fill-opacity': 1,
        }}
      />
      <Layer
        id="runway-outline"
        type="line"
        paint={{
          'line-color': '#94a3b8',
          'line-width': 1.5,
        }}
      />
    </Source>
  )
}
