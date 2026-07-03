import { useRef, useCallback, useEffect } from 'react'
import Map, { type MapRef, NavigationControl } from 'react-map-gl'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — mapbox-gl CSS import, types not needed
import 'mapbox-gl/dist/mapbox-gl.css'
import { useMapStore } from '../../store/useMapStore'
import { useAirportStore } from '../../store/useAirportStore'
import { AircraftOverlay } from './AircraftOverlay'
import { SelectedAircraftDataBlock } from './SelectedAircraftDataBlock'
import { ProcedureLayer } from './ProcedureLayer'
import { FlownSegmentLayer } from './FlownSegmentLayer'
import { AutoActiveSegmentsLayer } from './AutoActiveSegmentsLayer'
import { RunwayLayer } from './RunwayLayer'
import { ExtendedCenterlineLayer } from './ExtendedCenterlineLayer'
import { WaypointMarkers } from './WaypointMarkers'
import { ActiveProceduresOverlay } from '../layout/ActiveProceduresOverlay'
import { useAircraftInterpolation } from '../../hooks/useAircraftInterpolation'
import { useAircraftPoll } from '../../hooks/useAircraftPoll'
import { useProcedures } from '../../hooks/useProcedures'
import { useProcedureDetection } from '../../hooks/useProcedureDetection'
import { useRouteEnrichment } from '../../hooks/useRouteEnrichment'
import { useDatis } from '../../hooks/useDatis'
import { useRunways } from '../../hooks/useRunways'
import { useProcedureStore } from '../../store/useProcedureStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import type { Procedure } from '../../types/procedure'

// Render order: lowest value drawn first (bottom), highest last (top).
// Approaches are ordered I > R > H > L so precision ILS sits on top.
const APPROACH_RENDER_PRIORITY: Record<string, number> = { L: 2, H: 3, R: 4, I: 5 }
function approachRenderOrder(p: Procedure): number {
  if (p.type === 'SID') return 0
  if (p.type === 'STAR') return 1
  return APPROACH_RENDER_PRIORITY[p.name[0]?.toUpperCase()] ?? 2
}

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
  useRouteEnrichment()
  useDatis()
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

  const visibleProcedures = procedures
    .filter((p) => p.hasGeometry && (userToggles[p.id] ?? autoVisible[p.id] ?? false))
    .sort((a, b) => approachRenderOrder(a) - approachRenderOrder(b))

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

        <AutoActiveSegmentsLayer procedures={visibleProcedures} />

        <FlownSegmentLayer procedures={visibleProcedures} />

        <WaypointMarkers procedures={visibleProcedures} />

        <SelectedAircraftDataBlock />
      </Map>

      {/* DOM overlay so aircraft render above the waypoint markers and stay crisp */}
      <AircraftOverlay mapRef={mapRef} />

      <ActiveProceduresOverlay />
    </div>
  )
}
