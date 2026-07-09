import { useMemo } from 'react'
import { Source, Layer } from 'react-map-gl'
import type { FeatureCollection, Feature } from 'geojson'
import { useAirportStore, airportKey } from '../../store/useAirportStore'
import { useMapStore } from '../../store/useMapStore'

// Subtle mono ident label at each active airport, matching the muted slate of
// the other map labels. Hovering an AirportSection header in the sidebar
// (hoveredAirportKey) highlights the matching label.
const NORMAL_COLOR = '#94a3b8'
const HIGHLIGHT_COLOR = '#e2e8f0'

export function AirportLabelsLayer() {
  const activeAirports = useAirportStore((s) => s.activeAirports)
  const hoveredAirportKey = useMapStore((s) => s.hoveredAirportKey)

  const geojson = useMemo<FeatureCollection>(() => {
    const features: Feature[] = activeAirports.map((a) => {
      const key = airportKey(a)
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
        properties: { label: key, key },
      }
    })
    return { type: 'FeatureCollection', features }
  }, [activeAirports])

  if (activeAirports.length === 0) return null

  const hovered = hoveredAirportKey ?? ''

  return (
    <Source id="airport-labels" type="geojson" data={geojson}>
      <Layer
        id="airport-label-text"
        type="symbol"
        layout={{
          'text-field': ['get', 'label'],
          'text-size': ['case', ['==', ['get', 'key'], hovered], 13, 11],
          'text-anchor': 'top',
          'text-offset': [0, 0.9],
          'text-allow-overlap': true,
          'text-letter-spacing': 0.08,
        }}
        paint={{
          'text-color': ['case', ['==', ['get', 'key'], hovered], HIGHLIGHT_COLOR, NORMAL_COLOR],
          'text-halo-color': 'rgba(0,0,0,0.65)',
          'text-halo-width': 1.2,
        }}
      />
    </Source>
  )
}
