import { useEffect, useState } from 'react'
import { Source, Layer } from 'react-map-gl'
import type { Feature, FeatureCollection, LineString } from 'geojson'
import { useAircraftStore } from '../../store/useAircraftStore'
import { useSelectionStore, selectedHexOf } from '../../store/useSelectionStore'
import { usePathStore } from '../../store/usePathStore'
import { getTrack } from '../../services/trackLog'
import { altitudeColor } from '../../utils/colorScheme'
import { TRACKLOG_GAP_BREAK_MS } from '../../config/constants'

type TrackFeature = Feature<LineString, { color: string }>

const EMPTY: FeatureCollection<LineString, { color: string }> = { type: 'FeatureCollection', features: [] }

/**
 * Draws the selected aircraft's flown trail: one 2-point segment per
 * consecutive tracklog pair, colored by the older point's altitude (so the
 * trail reads as a mini altitude heatmap), plus a live final segment from the
 * newest logged point to the aircraft's current interpolated position so the
 * tail keeps up between polls. Recomputed on a 1s interval like
 * FlownSegmentLayer — the tracklog only grows once per poll, but the "final
 * segment" endpoint moves every interpolation frame.
 */
export function TrackLogLayer() {
  const selectedHex = useSelectionStore((s) => selectedHexOf(s.selected))
  const pathRevision = usePathStore((s) => s.pathRevision)
  const [fc, setFc] = useState<FeatureCollection<LineString, { color: string }>>(EMPTY)

  useEffect(() => {
    if (!selectedHex) {
      setFc(EMPTY)
      return
    }

    const recompute = () => {
      const track = getTrack(selectedHex)
      const features: TrackFeature[] = []

      for (let i = 1; i < track.length; i++) {
        const prev = track[i - 1]
        const curr = track[i]
        if (curr.tMs - prev.tMs > TRACKLOG_GAP_BREAK_MS) continue
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[prev.lon, prev.lat], [curr.lon, curr.lat]] },
          properties: { color: altitudeColor(prev.altFt) },
        })
      }

      const last = track[track.length - 1]
      if (last) {
        const ac = useAircraftStore.getState().aircraftMap.get(selectedHex)
        if (ac) {
          features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[last.lon, last.lat], [ac.interpLon, ac.interpLat]] },
            properties: { color: altitudeColor(last.altFt) },
          })
        }
      }

      setFc({ type: 'FeatureCollection', features })
    }

    recompute()
    const id = setInterval(recompute, 1000)
    return () => clearInterval(id)
  }, [selectedHex, pathRevision])

  return (
    <Source id="tracklog" type="geojson" data={fc}>
      <Layer
        id="tracklog-line"
        type="line"
        paint={{
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-opacity': 0.85,
        }}
        layout={{ 'line-join': 'round', 'line-cap': 'round' }}
      />
    </Source>
  )
}
