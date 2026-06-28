import { useMemo } from 'react'
import { Source, Layer } from 'react-map-gl'
import type { FeatureCollection, Feature, Point } from 'geojson'
import type { Procedure } from '../../types/procedure'

interface Props {
  procedures: Procedure[]
}

export function WaypointLayer({ procedures }: Props) {
  const waypointGeoJson = useMemo<FeatureCollection<Point>>(() => {
    const seen = new Set<string>()
    const features: Feature<Point>[] = []

    for (const proc of procedures) {
      for (const wpt of proc.waypoints) {
        const key = `${wpt.id}:${wpt.lat.toFixed(4)}:${wpt.lon.toFixed(4)}`
        if (seen.has(key)) continue
        seen.add(key)

        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [wpt.lon, wpt.lat] },
          properties: {
            id: wpt.id,
            navaidType: wpt.navaidType ?? 'FIX',
          },
        })
      }
    }

    return { type: 'FeatureCollection', features }
  }, [procedures])

  if (procedures.length === 0) return null

  return (
    <Source id="waypoints" type="geojson" data={waypointGeoJson}>
      {/* Fix triangles */}
      <Layer
        id="waypoints-fix"
        type="symbol"
        filter={['==', ['get', 'navaidType'], 'FIX']}
        layout={{
          'text-field': ['get', 'id'],
          'text-size': 9,
          'text-anchor': 'top-left',
          'text-offset': [0.3, 0.1],
          'icon-image': 'triangle-11',
          'icon-size': 0.7,
          'icon-allow-overlap': true,
        }}
        paint={{
          'icon-color': '#94a3b8',
          'text-color': '#94a3b8',
          'text-halo-color': 'rgba(0,0,0,0.6)',
          'text-halo-width': 1,
        }}
      />
      {/* VOR hexagon */}
      <Layer
        id="waypoints-vor"
        type="symbol"
        filter={['in', ['get', 'navaidType'], ['literal', ['VOR', 'VORTAC']]]}
        layout={{
          'text-field': ['get', 'id'],
          'text-size': 9,
          'text-anchor': 'top-left',
          'text-offset': [0.3, 0.1],
          'icon-image': 'airport-15',
          'icon-size': 0.8,
          'icon-allow-overlap': true,
        }}
        paint={{
          'icon-color': '#38bdf8',
          'text-color': '#38bdf8',
          'text-halo-color': 'rgba(0,0,0,0.6)',
          'text-halo-width': 1,
        }}
      />
      {/* NDB */}
      <Layer
        id="waypoints-ndb"
        type="symbol"
        filter={['==', ['get', 'navaidType'], 'NDB']}
        layout={{
          'text-field': ['get', 'id'],
          'text-size': 9,
          'text-anchor': 'top-left',
          'text-offset': [0.3, 0.1],
          'icon-image': 'circle-11',
          'icon-size': 0.7,
          'icon-allow-overlap': true,
        }}
        paint={{
          'icon-color': '#fb923c',
          'text-color': '#fb923c',
          'text-halo-color': 'rgba(0,0,0,0.6)',
          'text-halo-width': 1,
        }}
      />
    </Source>
  )
}
