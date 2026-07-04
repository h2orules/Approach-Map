import { useEffect, useMemo, useRef, useState } from 'react'
import { Source, Layer, Marker, useMap } from 'react-map-gl'
import type { Expression } from 'mapbox-gl'
import type { FeatureCollection, Feature } from 'geojson'
import type { SafeAltitudeArea, SafeAltitudeSector } from '../../types/safeAltitude'
import { sectorPolygon, sectorBoundaryLines, sectorLabelAnchor } from '../../geo/safeAltitude'
import { useSettingsStore } from '../../store/useSettingsStore'
import {
  MSA_DEFAULT_RADIUS_NM,
  SAFE_ALT_COLOR,
  SAFE_ALT_FILL_OPACITY,
  SAFE_ALT_LINE_WIDTH,
  SAFE_ALT_LINE_OPACITY,
} from '../../config/constants'
import styles from './SafeAltitudeLayer.module.css'

interface Props {
  items: Array<{ icao: string; area: SafeAltitudeArea }>
}

// Solid for TAA, dashed for MSA — both share the same neutral color, so the
// only thing that varies per-feature is the dash pattern.
const LINE_DASH_EXPRESSION: Expression = [
  'case',
  ['==', ['get', 'kind'], 'MSA'],
  ['literal', [4, 3]],
  ['literal', [1, 0]],
]

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

function buildGeojson(items: Props['items']): FeatureCollection {
  if (items.length === 0) return EMPTY_FC

  const features: Feature[] = []
  for (const { area } of items) {
    for (const sector of area.sectors) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [sectorPolygon(area.centerLat, area.centerLon, sector)] },
        properties: { kind: area.kind },
      })
    }
    for (const line of sectorBoundaryLines(area)) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: line },
        properties: { kind: area.kind },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

/** Plate-style tag shown once per area, on its first sector's label only. */
function areaTag(area: SafeAltitudeArea, multi: boolean): string {
  if (area.kind === 'MSA') return `MSA ${area.centerFixId} ${MSA_DEFAULT_RADIUS_NM} NM`
  return multi ? `TAA ${area.icao}` : 'TAA'
}

interface LabelInfo {
  key: string
  lon: number
  lat: number
  sector: SafeAltitudeSector
  tag: string | null
}

export function SafeAltitudeLayer({ items }: Props) {
  const showSafeAltitudes = useSettingsStore((s) => s.showSafeAltitudes)
  const { current: mapRef } = useMap()
  const [labels, setLabels] = useState<LabelInfo[]>([])
  const rafRef = useRef<number | null>(null)

  const geojson = useMemo(() => buildGeojson(items), [items])
  const visibility = showSafeAltitudes ? 'visible' : 'none'

  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map || !showSafeAltitudes) {
      setLabels([])
      return
    }

    const recompute = () => {
      const b = map.getBounds()
      const bounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }
      const multi = items.length > 1

      const next: LabelInfo[] = []
      for (const { area } of items) {
        area.sectors.forEach((sector, i) => {
          const anchor = sectorLabelAnchor(area.centerLat, area.centerLon, sector, bounds)
          if (!anchor) return
          const [lon, lat] = anchor
          next.push({
            key: `${area.icao}-${area.kind}-${area.centerFixId}-${i}`,
            lon,
            lat,
            sector,
            tag: i === 0 ? areaTag(area, multi) : null,
          })
        })
      }
      setLabels(next)
    }

    const schedule = () => {
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        recompute()
      })
    }

    recompute()
    map.on('moveend', schedule)
    return () => {
      map.off('moveend', schedule)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [mapRef, items, showSafeAltitudes])

  return (
    <>
      <Source id="safealt" type="geojson" data={geojson}>
        <Layer
          id="safealt-fill"
          type="fill"
          filter={['==', ['geometry-type'], 'Polygon']}
          layout={{ visibility }}
          paint={{
            'fill-color': SAFE_ALT_COLOR,
            'fill-opacity': SAFE_ALT_FILL_OPACITY,
          }}
        />
        <Layer
          id="safealt-line"
          type="line"
          filter={['==', ['geometry-type'], 'LineString']}
          layout={{ visibility }}
          paint={{
            'line-color': SAFE_ALT_COLOR,
            'line-width': SAFE_ALT_LINE_WIDTH,
            'line-opacity': SAFE_ALT_LINE_OPACITY,
            'line-dasharray': LINE_DASH_EXPRESSION,
          }}
        />
      </Source>

      {showSafeAltitudes &&
        labels.map((l) => (
          <Marker key={l.key} longitude={l.lon} latitude={l.lat} anchor="center">
            <div className={styles.container}>
              <div className={styles.box}>{l.sector.altitudeFt}</div>
              {l.tag && <div className={styles.tag}>{l.tag}</div>}
            </div>
          </Marker>
        ))}
    </>
  )
}
