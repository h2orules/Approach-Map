import { useEffect, useMemo } from 'react'
import { Source, Layer, Marker } from 'react-map-gl'
import type { FeatureCollection, Feature, Position } from 'geojson'
import * as turf from '@turf/turf'
import { useAirportStore } from '../../store/useAirportStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useMvaStore, ensureMvaLoaded } from '../../services/mvaData'
import type { MvaSector } from '../../utils/aixmMva'
import {
  MVA_COLOR,
  MVA_FILL_OPACITY,
  MVA_LINE_WIDTH,
  MVA_LINE_OPACITY,
} from '../../config/constants'
import styles from './MvaLayer.module.css'

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

function buildGeojson(sectors: MvaSector[]): FeatureCollection {
  if (sectors.length === 0) return EMPTY_FC

  const features: Feature[] = sectors.map((sector) => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: sector.polygon },
    properties: { name: sector.name, minAltFt: sector.minAltFt },
  }))
  return { type: 'FeatureCollection', features }
}

interface LabelInfo {
  key: string
  lon: number
  lat: number
  minAltFt: number
}

/** Centroid of a sector's exterior ring, for the boxed altitude label. */
function sectorLabelAnchor(sector: MvaSector): Position | null {
  const exterior = sector.polygon[0]
  if (!exterior || exterior.length < 3) return null
  try {
    const centroid = turf.centerOfMass(turf.polygon([exterior]))
    return centroid.geometry.coordinates as Position
  } catch {
    return null
  }
}

// MVA (Minimum Vectoring Altitude) sector overlay. This component is ALWAYS
// mounted (see AppMap) with visibility toggled via `layout.visibility` —
// same rationale as TerrainLayer/SafeAltitudeLayer: declarative Source/Layer
// children keep a stable position in the runtime layer stack across toggles.
// Data is fetched lazily: only when the toggle is on do we call
// ensureMvaLoaded, so airports the user never enables MVA for never hit the
// network/IndexedDB (see src/services/mvaData.ts for the fetch/cache and
// src/utils/mvaFacilities.ts for how facility IDs are guessed).
export function MvaLayer() {
  const showMva = useSettingsStore((s) => s.showMva)
  const selectedAirport = useAirportStore((s) => s.selectedAirport)
  const icao = selectedAirport?.icao ?? null
  const byIcao = useMvaStore((s) => s.byIcao)

  useEffect(() => {
    if (!showMva || !icao) return
    ensureMvaLoaded(icao)
  }, [showMva, icao])

  const sectors = useMemo(() => (icao ? byIcao[icao.toUpperCase()] ?? [] : []), [icao, byIcao])

  const geojson = useMemo(() => buildGeojson(sectors), [sectors])
  const visibility = showMva ? 'visible' : 'none'

  const labels = useMemo<LabelInfo[]>(() => {
    if (!showMva) return []
    const out: LabelInfo[] = []
    sectors.forEach((sector, i) => {
      const anchor = sectorLabelAnchor(sector)
      if (!anchor) return
      const [lon, lat] = anchor
      out.push({ key: `mva-${sector.name}-${i}`, lon, lat, minAltFt: sector.minAltFt })
    })
    return out
  }, [sectors, showMva])

  return (
    <>
      <Source id="mva" type="geojson" data={geojson}>
        <Layer
          id="mva-fill"
          type="fill"
          layout={{ visibility }}
          paint={{
            'fill-color': MVA_COLOR,
            'fill-opacity': MVA_FILL_OPACITY,
          }}
        />
        <Layer
          id="mva-line"
          type="line"
          layout={{ visibility }}
          paint={{
            'line-color': MVA_COLOR,
            'line-width': MVA_LINE_WIDTH,
            'line-opacity': MVA_LINE_OPACITY,
          }}
        />
      </Source>

      {showMva &&
        labels.map((l) => (
          <Marker key={l.key} longitude={l.lon} latitude={l.lat} anchor="center">
            <div className={styles.box}>{l.minAltFt.toLocaleString('en-US')}</div>
          </Marker>
        ))}
    </>
  )
}
