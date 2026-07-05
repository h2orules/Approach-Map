import { useEffect, useMemo } from 'react'
import { Source, Layer, Marker } from 'react-map-gl'
import type { FeatureCollection, Feature, Position } from 'geojson'
import type { Expression } from 'mapbox-gl'
import * as turf from '@turf/turf'
import { useAirportStore } from '../../store/useAirportStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useAirspaceStore, ensureAirspaceLoaded } from '../../services/airspaceData'
import { airspaceAltLabel } from '../../utils/airspaceFormat'
import type { AirspaceSector } from '../../types/airspace'
import {
  AIRSPACE_BLUE,
  AIRSPACE_MAGENTA,
  AIRSPACE_FILL_OPACITY,
  AIRSPACE_LINE_OPACITY,
  AIRSPACE_E_TRANS_LINE_OPACITY,
  AIRSPACE_SOLID_LINE_WIDTH,
  AIRSPACE_DASHED_LINE_WIDTH,
} from '../../config/constants'
import styles from './AirspaceLayer.module.css'

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

function buildGeojson(sectors: AirspaceSector[]): FeatureCollection {
  const features: Feature[] = sectors.map((s) => ({
    type: 'Feature',
    geometry: s.geometry,
    properties: { style: s.style, class: s.airspaceClass },
  }))
  return { type: 'FeatureCollection', features }
}

// Fill: blue for B/D, magenta for C/E-surface. The E transition areas are
// excluded from the fill entirely (see the fill layer's filter) — they cover
// most of the chart and would wash the basemap magenta.
const FILL_COLOR: Expression = [
  'match',
  ['get', 'style'],
  'C', AIRSPACE_MAGENTA,
  'E_SFC', AIRSPACE_MAGENTA,
  AIRSPACE_BLUE, // B, D
]

interface LabelInfo {
  key: string
  lon: number
  lat: number
  ceiling: string
  floor: string | null
  airspaceClass: AirspaceSector['airspaceClass']
}

/** Interior anchor for a sector's boxed altitude label (never outside the polygon). */
function labelAnchor(sector: AirspaceSector): Position | null {
  try {
    const p = turf.pointOnFeature(turf.feature(sector.geometry))
    return p.geometry.coordinates as Position
  } catch {
    return null
  }
}

// Airspace (Class B/C/D/E) overlay, drawn FAA-sectional style. Always mounted
// with visibility toggled via `layout.visibility` (same rationale as
// MvaLayer/SafeAltitudeLayer — keeps a stable slot in the GL layer stack).
// Data is fetched lazily per selected airport only when the toggle is on.
export function AirspaceLayer() {
  const showAirspace = useSettingsStore((s) => s.showAirspace)
  const selectedAirport = useAirportStore((s) => s.selectedAirport)
  const byIcao = useAirspaceStore((s) => s.byIcao)

  const icao = selectedAirport?.icao ?? null

  useEffect(() => {
    if (!showAirspace || !selectedAirport) return
    ensureAirspaceLoaded(selectedAirport.icao, selectedAirport.lat, selectedAirport.lon)
  }, [showAirspace, selectedAirport])

  const sectors = useMemo(
    () => (icao ? byIcao[icao.toUpperCase()] ?? [] : []),
    [icao, byIcao],
  )

  const geojson = useMemo(() => buildGeojson(sectors), [sectors])
  const visibility = showAirspace ? 'visible' : 'none'

  const labels = useMemo<LabelInfo[]>(() => {
    if (!showAirspace) return []
    const out: LabelInfo[] = []
    sectors.forEach((sector, i) => {
      const label = airspaceAltLabel(sector)
      if (!label) return
      const anchor = labelAnchor(sector)
      if (!anchor) return
      const [lon, lat] = anchor
      out.push({
        key: `${sector.localType}-${i}`,
        lon,
        lat,
        ceiling: label.ceiling,
        floor: label.floor,
        airspaceClass: sector.airspaceClass,
      })
    })
    return out
  }, [sectors, showAirspace])

  return (
    <>
      <Source id="airspace" type="geojson" data={showAirspace ? geojson : EMPTY_FC}>
        <Layer
          id="airspace-fill"
          type="fill"
          filter={['!=', ['get', 'style'], 'E_TRANS']}
          layout={{ visibility }}
          paint={{ 'fill-color': FILL_COLOR, 'fill-opacity': AIRSPACE_FILL_OPACITY }}
        />
        {/* Class B & C — solid boundary. */}
        <Layer
          id="airspace-line-solid"
          type="line"
          filter={['in', ['get', 'style'], ['literal', ['B', 'C']]]}
          layout={{ visibility, 'line-join': 'round' }}
          paint={{
            'line-color': ['match', ['get', 'style'], 'C', AIRSPACE_MAGENTA, AIRSPACE_BLUE] as Expression,
            'line-width': AIRSPACE_SOLID_LINE_WIDTH,
            'line-opacity': AIRSPACE_LINE_OPACITY,
          }}
        />
        {/* Class D — dashed blue. */}
        <Layer
          id="airspace-line-d"
          type="line"
          filter={['==', ['get', 'style'], 'D']}
          layout={{ visibility, 'line-join': 'round' }}
          paint={{
            'line-color': AIRSPACE_BLUE,
            'line-width': AIRSPACE_DASHED_LINE_WIDTH,
            'line-opacity': AIRSPACE_LINE_OPACITY,
            'line-dasharray': [2.5, 1.5],
          }}
        />
        {/* Class E surface area — dashed magenta (the sectional "zipper"). */}
        <Layer
          id="airspace-line-esfc"
          type="line"
          filter={['==', ['get', 'style'], 'E_SFC']}
          layout={{ visibility, 'line-join': 'round' }}
          paint={{
            'line-color': AIRSPACE_MAGENTA,
            'line-width': AIRSPACE_DASHED_LINE_WIDTH,
            'line-opacity': AIRSPACE_LINE_OPACITY,
            'line-dasharray': [1.5, 1.5],
          }}
        />
        {/* Class E transition (700/1200ft AGL) — faint magenta boundary only,
            no fill, so these huge areas don't wash out the basemap. */}
        <Layer
          id="airspace-line-etrans"
          type="line"
          filter={['==', ['get', 'style'], 'E_TRANS']}
          layout={{ visibility, 'line-join': 'round' }}
          paint={{
            'line-color': AIRSPACE_MAGENTA,
            'line-width': 1,
            'line-opacity': AIRSPACE_E_TRANS_LINE_OPACITY,
          }}
        />
      </Source>

      {showAirspace &&
        labels.map((l) => (
          <Marker key={l.key} longitude={l.lon} latitude={l.lat} anchor="center">
            {l.airspaceClass === 'D' ? (
              <div className={`${styles.box} ${styles.classD}`}>[{l.ceiling}]</div>
            ) : (
              <div className={`${styles.frac} ${l.airspaceClass === 'C' ? styles.classC : styles.classB}`}>
                <span className={styles.ceil}>{l.ceiling}</span>
                <span className={styles.floor}>{l.floor}</span>
              </div>
            )}
          </Marker>
        ))}
    </>
  )
}
