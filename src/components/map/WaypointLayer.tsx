import { useEffect, useMemo, useState } from 'react'
import { Source, Layer, useMap } from 'react-map-gl'
import type { FeatureCollection, Feature, Point } from 'geojson'
import type { Procedure, WaypointSymbol } from '../../types/procedure'
import { svgToImage } from '../../utils/mapImages'

interface Props {
  procedures: Procedure[]
}

// Aviation symbology, baked-color SVGs (dark halo for contrast on any basemap).
const HALO = 'stroke="#0b0f14" stroke-width="1.6" stroke-linejoin="round"'
const ICONS: Record<string, string> = {
  // Intersection / RNAV fix — solid triangle
  'wp-fix': `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M11 4 L18 17 L4 17 Z" fill="#cbd5e1" ${HALO}/></svg>`,
  // VOR — hexagon with center dot
  'wp-vor': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 3 L20 7.5 L20 16.5 L12 21 L4 16.5 L4 7.5 Z" fill="none" stroke="#7dd3fc" stroke-width="2.2"/><path d="M12 3 L20 7.5 L20 16.5 L12 21 L4 16.5 L4 7.5 Z" fill="none" ${HALO}/><circle cx="12" cy="12" r="2" fill="#7dd3fc"/></svg>`,
  // NDB — dot encircled by a dotted ring
  'wp-ndb': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#fbbf24" stroke-width="1.6" stroke-dasharray="1.5 2.2"/><circle cx="12" cy="12" r="2.4" fill="#fbbf24" ${HALO}/></svg>`,
  // FAF — Maltese cross
  'wp-faf': `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 2 L14.5 7 L12 9 L9.5 7 Z M12 22 L14.5 17 L12 15 L9.5 17 Z M2 12 L7 9.5 L9 12 L7 14.5 Z M22 12 L17 9.5 L15 12 L17 14.5 Z" fill="#f0abfc" ${HALO}/></svg>`,
  // MAP / runway threshold — square
  'wp-rwy': `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><rect x="5" y="5" width="10" height="10" fill="#86efac" ${HALO}/></svg>`,
}

function symbolKey(s: WaypointSymbol): string {
  if (s.role === 'faf') return 'wp-faf'
  if (s.role === 'map') return 'wp-rwy'
  if (s.navaidType === 'VOR' || s.navaidType === 'VORTAC') return 'wp-vor'
  if (s.navaidType === 'NDB') return 'wp-ndb'
  if (s.navaidType === 'RUNWAY') return 'wp-rwy'
  return 'wp-fix'
}

export function WaypointLayer({ procedures }: Props) {
  const { current: map } = useMap()
  const [iconsReady, setIconsReady] = useState(false)

  useEffect(() => {
    const m = map?.getMap()
    if (!m) return
    let cancelled = false

    const register = async () => {
      await Promise.all(
        Object.entries(ICONS).map(async ([id, svg]) => {
          if (m.hasImage(id)) return
          const img = await svgToImage(svg)
          if (!cancelled && !m.hasImage(id)) m.addImage(id, img, { pixelRatio: 2 })
        }),
      )
      if (!cancelled) setIconsReady(true)
    }

    if (m.isStyleLoaded()) void register()
    else m.once('load', () => void register())

    return () => {
      cancelled = true
    }
  }, [map])

  const geojson = useMemo<FeatureCollection<Point>>(() => {
    const seen = new Set<string>()
    const features: Feature<Point>[] = []

    for (const proc of procedures) {
      for (const s of proc.symbols) {
        const key = `${s.id}:${s.lat.toFixed(4)}:${s.lon.toFixed(4)}`
        if (seen.has(key)) continue
        seen.add(key)
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
          properties: { id: s.id, sym: symbolKey(s), alt: s.altText ?? '' },
        })
      }
    }
    return { type: 'FeatureCollection', features }
  }, [procedures])

  if (procedures.length === 0 || !iconsReady) return null

  return (
    <Source id="waypoints" type="geojson" data={geojson}>
      {/* Symbols, above the procedure lines */}
      <Layer
        id="waypoint-symbols"
        type="symbol"
        layout={{
          'icon-image': ['get', 'sym'],
          'icon-size': 0.85,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        }}
      />
      {/* Fix name — offset up-right of the symbol so the procedure line stays clear */}
      <Layer
        id="waypoint-labels"
        type="symbol"
        layout={{
          'text-field': ['get', 'id'],
          'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
          'text-size': 13,
          'text-offset': [0.8, -0.7],
          'text-anchor': 'left',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        }}
        paint={{
          'text-color': '#f8fafc',
          'text-halo-color': '#0b0f14',
          'text-halo-width': 2,
        }}
      />
      {/* Altitude restriction — just below the name, same offset side */}
      <Layer
        id="waypoint-alt"
        type="symbol"
        filter={['!=', ['get', 'alt'], '']}
        layout={{
          'text-field': ['get', 'alt'],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-size': 11,
          'text-offset': [0.8, 0.7],
          'text-anchor': 'left',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        }}
        paint={{
          'text-color': '#fde68a',
          'text-halo-color': '#0b0f14',
          'text-halo-width': 2,
        }}
      />
    </Source>
  )
}
