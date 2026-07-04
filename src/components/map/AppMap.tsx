import { useRef, useCallback, useEffect, useMemo, useState } from 'react'
import Map, { type MapRef, type MapLayerMouseEvent, NavigationControl } from 'react-map-gl'
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
import { TerrainLayer } from './TerrainLayer'
import { SafeAltitudeLayer } from './SafeAltitudeLayer'
import { WaypointMarkers } from './WaypointMarkers'
import { ActiveProceduresOverlay } from '../layout/ActiveProceduresOverlay'
import { AltitudeFilter } from './AltitudeFilter'
import { ProfilePanel } from '../profile/ProfilePanel'
import { useAircraftInterpolation } from '../../hooks/useAircraftInterpolation'
import { useAircraftPoll } from '../../hooks/useAircraftPoll'
import { useProcedures } from '../../hooks/useProcedures'
import { useProcedureDetection } from '../../hooks/useProcedureDetection'
import { useRouteEnrichment } from '../../hooks/useRouteEnrichment'
import { useDatis } from '../../hooks/useDatis'
import { useRunways } from '../../hooks/useRunways'
import { useSafeAltitudes } from '../../hooks/useSafeAltitudes'
import { useProcedureStore } from '../../store/useProcedureStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useSelectionStore } from '../../store/useSelectionStore'
import { useSelectionGuards, computeVisibility } from '../../hooks/useSelectionGuards'
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
  const selectedAirport = useAirportStore((s) => s.selectedAirport)
  const toggleSelection = useSelectionStore((s) => s.toggle)
  const clearSelection = useSelectionStore((s) => s.clear)
  const [hoverCursor, setHoverCursor] = useState(false)

  useAircraftInterpolation()
  useAircraftPoll()
  useProcedures()
  useProcedureDetection()
  useRouteEnrichment()
  useDatis()
  useRunways()
  useSelectionGuards()

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
    .filter((p) => p.hasGeometry && computeVisibility(userToggles, autoVisible, p.id))
    .sort((a, b) => approachRenderOrder(a) - approachRenderOrder(b))

  const safeAltIcaos = useMemo(
    () => (selectedAirport ? [selectedAirport.icao] : []),
    [selectedAirport],
  )
  const safeAltItems = useSafeAltitudes(safeAltIcaos)

  const interactiveLayerIds = visibleProcedures
    .filter((p) => p.type === 'APPROACH')
    .map((p) => `proc-hit-${p.id}`)

  const handleMapClick = useCallback(
    (evt: MapLayerMouseEvent) => {
      const f = evt.features?.[0]
      if (!f) {
        clearSelection()
        return
      }
      const m = /^proc-hit-(.+)$/.exec(f.layer.id)
      if (m) toggleSelection({ kind: 'approach', procedureId: m[1] })
    },
    [clearSelection, toggleSelection],
  )

  const handleMouseEnter = useCallback(() => setHoverCursor(true), [])
  const handleMouseLeave = useCallback(() => setHoverCursor(false), [])

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
        interactiveLayerIds={interactiveLayerIds}
        cursor={hoverCursor ? 'pointer' : undefined}
        onClick={handleMapClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <NavigationControl position="bottom-right" />

        {/* Terrain and safe-altitude overlays are always mounted (visibility
            toggled via layout.visibility) rather than conditionally rendered,
            so their runtime GL layers keep a stable position in the render
            order across toggles — see the z-order rationale comment atop
            TerrainLayer.tsx. */}
        <TerrainLayer />

        <SafeAltitudeLayer items={safeAltItems} />

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

      <AltitudeFilter />

      <ActiveProceduresOverlay />

      <ProfilePanel mapRef={mapRef} />
    </div>
  )
}
