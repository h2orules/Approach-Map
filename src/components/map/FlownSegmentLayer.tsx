import { useEffect, useState } from 'react'
import { Source, Layer } from 'react-map-gl'
import type { Feature, LineString } from 'geojson'
import type { Procedure } from '../../types/procedure'
import { useAircraftStore } from '../../store/useAircraftStore'
import { findFlownSegment } from '../../geo/flownSegment'
import { ACTIVE_SEGMENT_COLOR } from '../../utils/colorScheme'

interface Props {
  procedures: Procedure[]
}

/**
 * Highlights, in magenta, the single procedure leg the selected aircraft is
 * flying — like the active leg on a GPS/FMS moving map. Recomputed on a light
 * interval (the aircraft interpolates at 60fps, but the active leg changes
 * slowly) to avoid per-frame turf work.
 */
export function FlownSegmentLayer({ procedures }: Props) {
  const selectedHex = useAircraftStore((s) => s.selectedHex)
  const [segment, setSegment] = useState<Feature<LineString> | null>(null)

  useEffect(() => {
    if (!selectedHex || procedures.length === 0) {
      setSegment(null)
      return
    }

    const recompute = () => {
      const ac = useAircraftStore.getState().aircraftMap.get(selectedHex)
      if (!ac) {
        setSegment(null)
        return
      }
      setSegment(findFlownSegment(ac.interpLat, ac.interpLon, ac.track, procedures))
    }

    recompute()
    const id = setInterval(recompute, 1000)
    return () => clearInterval(id)
  }, [selectedHex, procedures])

  if (!segment) return null

  return (
    <Source id="flown-segment" type="geojson" data={segment}>
      <Layer
        id="flown-segment-line"
        type="line"
        paint={{
          'line-color': ACTIVE_SEGMENT_COLOR,
          'line-width': 4,
          'line-opacity': 0.95,
        }}
        layout={{ 'line-join': 'round', 'line-cap': 'round' }}
      />
    </Source>
  )
}
