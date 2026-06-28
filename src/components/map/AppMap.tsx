import { useRef, useCallback, useEffect } from 'react'
import Map, { type MapRef, NavigationControl } from 'react-map-gl'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — mapbox-gl CSS import, types not needed
import 'mapbox-gl/dist/mapbox-gl.css'
import { useMapStore } from '../../store/useMapStore'
import { useAirportStore } from '../../store/useAirportStore'
import { AircraftLayer } from './AircraftLayer'
import { ProcedureLayer } from './ProcedureLayer'
import { FlownSegmentLayer } from './FlownSegmentLayer'
import { RunwayLayer } from './RunwayLayer'
import { ExtendedCenterlineLayer } from './ExtendedCenterlineLayer'
import { WaypointLayer } from './WaypointLayer'
import { ActiveProceduresOverlay } from '../layout/ActiveProceduresOverlay'
import { useAircraftInterpolation } from '../../hooks/useAircraftInterpolation'
import { useAircraftPoll } from '../../hooks/useAircraftPoll'
import { useProcedures } from '../../hooks/useProcedures'
import { useProcedureDetection } from '../../hooks/useProcedureDetection'
import { useRunways } from '../../hooks/useRunways'
import { useProcedureStore } from '../../store/useProcedureStore'
import { useSettingsStore } from '../../store/useSettingsStore'

export function AppMap() {
  const mapRef = useRef<MapRef | null>(null)
  const { viewport, setViewport, getMapStyle } = useMapStore()
  const procedures = useProcedureStore((s) => s.procedures)
  const userToggles = useProcedureStore((s) => s.userToggles)
  const autoVisible = useProcedureStore((s) => s.autoVisible)
  const showCenterlines = useSettingsStore((s) => s.showExtendedCenterlines)
  const runways = useAirportStore((s) => s.runways)

  useAircraftInterpolation()
  useAircraftPoll()
  useProcedures()
  useProcedureDetection()
  useRunways()

  // On reload, center the map on the airport restored from the last session.
  useEffect(() => {
    const restored = useAirportStore.getState().selectedAirport
    if (restored) {
      setViewport({ longitude: restored.lon, latitude: restored.lat, zoom: 11 })
    }
    // Run once on mount; subsequent selections set the viewport via AirportSearch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleMove = useCallback(
    (evt: { viewState: { longitude: number; latitude: number; zoom: number } }) => {
      setViewport(evt.viewState)
    },
    [setViewport],
  )

  const visibleProcedures = procedures.filter(
    (p) => p.hasGeometry && (userToggles[p.id] ?? autoVisible[p.id] ?? false),
  )

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Map
        ref={mapRef}
        longitude={viewport.longitude}
        latitude={viewport.latitude}
        zoom={viewport.zoom}
        onMove={handleMove}
        mapStyle={getMapStyle()}
        mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
      >
        <NavigationControl position="bottom-right" />

        <RunwayLayer runways={runways} />

        {showCenterlines && <ExtendedCenterlineLayer runways={runways} />}

        {visibleProcedures.map((p) => (
          <ProcedureLayer key={p.id} procedure={p} />
        ))}

        <FlownSegmentLayer procedures={visibleProcedures} />

        <WaypointLayer procedures={visibleProcedures} />

        <AircraftLayer mapRef={mapRef} />
      </Map>

      <ActiveProceduresOverlay />
    </div>
  )
}
