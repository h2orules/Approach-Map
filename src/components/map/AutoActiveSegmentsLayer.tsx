import { useEffect, useMemo, useState } from 'react'
import { Source, Layer } from 'react-map-gl'
import type { FeatureCollection } from 'geojson'
import type { Procedure } from '../../types/procedure'
import { useAircraftStore } from '../../store/useAircraftStore'
import { useSelectionStore, selectedHexOf } from '../../store/useSelectionStore'
import { findActiveSegments } from '../../geo/activeSegments'

interface Props {
  /** All currently visible procedures (pre-filtered to visible). */
  procedures: Procedure[]
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

/**
 * Draws the legs that non-selected aircraft are actively flying, thick in the
 * procedure's own color: every leg of a visible SID/STAR, and the thin *feeder*
 * legs of a visible approach (their final segment keeps its own width). Legs
 * nobody is flying stay at the base width ProcedureLayer draws.
 */
export function AutoActiveSegmentsLayer({ procedures }: Props) {
  const selectedHex = useSelectionStore((s) => selectedHexOf(s.selected))
  const [segments, setSegments] = useState<FeatureCollection>(EMPTY)

  // SID/STAR (every leg) plus approaches (feeder legs only, decided inside
  // findActiveSegments) — an approach with no feeder features contributes
  // nothing, so this stays cheap.
  const eligibleProcs = useMemo(
    () => procedures.filter((p) => p.type === 'SID' || p.type === 'STAR' || p.type === 'APPROACH'),
    [procedures],
  )

  useEffect(() => {
    if (eligibleProcs.length === 0) {
      setSegments(EMPTY)
      return
    }

    const recompute = () => {
      const aircraft = Array.from(useAircraftStore.getState().aircraftMap.values())
      setSegments(findActiveSegments(aircraft, eligibleProcs, selectedHex))
    }

    recompute()
    const id = setInterval(recompute, 1000)
    return () => clearInterval(id)
  }, [eligibleProcs, selectedHex])

  return (
    <Source id="auto-active-segments" type="geojson" data={segments}>
      <Layer
        id="auto-active-segments-line"
        type="line"
        paint={{
          'line-color': ['get', 'color'],
          'line-width': 3,
          'line-opacity': 0.95,
        }}
        layout={{ 'line-join': 'round', 'line-cap': 'round' }}
      />
    </Source>
  )
}
