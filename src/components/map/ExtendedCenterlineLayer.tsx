import { useMemo } from 'react'
import { Source, Layer } from 'react-map-gl'
import type { FeatureCollection, Feature, LineString } from 'geojson'
import type { Runway } from '../../types/airport'
import { useSettingsStore } from '../../store/useSettingsStore'
import { buildExtendedCenterline } from '../../geo/extendedCenterline'
import { EXTENDED_CENTERLINE_COLOR } from '../../utils/colorScheme'

interface Props {
  runways: Runway[]
}

export function ExtendedCenterlineLayer({ runways }: Props) {
  const lengthNm = useSettingsStore((s) => s.extendedCenterlineLengthNm)

  const geojson = useMemo<FeatureCollection>(() => {
    const features: Feature[] = []

    for (const runway of runways) {
      const { lowEnd, highEnd } = runway
      if (!lowEnd?.lat || !highEnd?.lat) continue

      for (const [end, otherEnd] of [[lowEnd, highEnd], [highEnd, lowEnd]] as [typeof lowEnd, typeof highEnd][]) {
        const { line, runwayId } = buildExtendedCenterline(end, otherEnd, lengthNm)
        features.push({
          ...line,
          properties: { runwayId },
        })

        // Label point at far end
        const coords = (line.geometry as LineString).coordinates
        const farEnd = coords[coords.length - 1]
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: farEnd },
          properties: { label: runwayId },
        })
      }
    }

    return { type: 'FeatureCollection', features }
  }, [runways, lengthNm])

  if (runways.length === 0) return null

  return (
    <Source id="extended-centerlines" type="geojson" data={geojson}>
      <Layer
        id="centerline-lines"
        type="line"
        filter={['==', ['geometry-type'], 'LineString']}
        paint={{
          'line-color': EXTENDED_CENTERLINE_COLOR,
          'line-width': 1,
          'line-dasharray': [4, 3],
          'line-opacity': 0.7,
        }}
      />
      <Layer
        id="centerline-labels"
        type="symbol"
        filter={['==', ['geometry-type'], 'Point']}
        layout={{
          'text-field': ['get', 'label'],
          'text-size': 10,
          'text-anchor': 'center',
        }}
        paint={{
          'text-color': EXTENDED_CENTERLINE_COLOR,
          'text-halo-color': 'rgba(0,0,0,0.6)',
          'text-halo-width': 1,
        }}
      />
    </Source>
  )
}
