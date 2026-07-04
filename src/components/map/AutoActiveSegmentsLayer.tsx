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
 * For each visible SID/STAR, draws only the legs that non-selected aircraft
 * are actively flying, thick in the procedure's own color. Non-active legs
 * stay at the base 1.5px drawn by ProcedureLayer.
 */
export function AutoActiveSegmentsLayer({ procedures }: Props) {
  const selectedHex = useSelectionStore((s) => selectedHexOf(s.selected))
  const [segments, setSegments] = useState<FeatureCollection>(EMPTY)

  const sidStarProcs = useMemo(
    () => procedures.filter((p) => p.type === 'SID' || p.type === 'STAR'),
    [procedures],
  )

  useEffect(() => {
    if (sidStarProcs.length === 0) {
      setSegments(EMPTY)
      return
    }

    const recompute = () => {
      const aircraft = Array.from(useAircraftStore.getState().aircraftMap.values())
      setSegments(findActiveSegments(aircraft, sidStarProcs, selectedHex))
    }

    recompute()
    const id = setInterval(recompute, 1000)
    return () => clearInterval(id)
  }, [sidStarProcs, selectedHex])

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
