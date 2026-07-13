import { useMemo } from 'react'
import { Source, Layer } from 'react-map-gl'
import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import type { AlertTier, PredPoint } from '../../types/path'
import { usePathStore } from '../../store/usePathStore'
import { useSelectionStore, selectedHexOf } from '../../store/useSelectionStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import {
  PREDICTION_LINE_COLOR,
  ALERT_AMBER,
  WARNING_RED,
  PREDICT_STEP_S,
  CONFLICT_HORIZON_S,
} from '../../config/constants'

const EMPTY_LINES: FeatureCollection<LineString> = { type: 'FeatureCollection', features: [] }
const EMPTY_POINTS: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] }

/** WARNING_RED for the two escalated tiers, ALERT_AMBER for the advisory ones. */
function tierColor(tier: AlertTier): string {
  return tier === 'warning' || tier === 'ra' ? WARNING_RED : ALERT_AMBER
}

function lineFeature(points: PredPoint[], properties: Record<string, string> = {}): Feature<LineString> | null {
  if (points.length < 2) return null
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: points.map((p) => [p.lon, p.lat]) },
    properties,
  }
}

function dotFeature(point: PredPoint, properties: Record<string, string> = {}): Feature<Point> {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
    properties,
  }
}

/**
 * Two responsibilities layered into one component:
 *  1. The selected aircraft's own predicted path, gated on the
 *     `showPredictedPaths` setting and sliced to `predictionMinutes`.
 *  2. A force-shown predicted path (sliced to CONFLICT_HORIZON_S) for every
 *     aircraft in a conflict pair, colored by alert tier — this ignores the
 *     toggle and selection entirely, since a projected loss of separation is
 *     always worth seeing. A selected hex that's also conflicted renders only
 *     the conflict styling (no duplicate white line underneath).
 */
export function PredictionLayer() {
  const predictions = usePathStore((s) => s.predictions)
  const conflictPairs = usePathStore((s) => s.conflictPairs)
  const selectedHex = useSelectionStore((s) => selectedHexOf(s.selected))
  const showPredictedPaths = useSettingsStore((s) => s.showPredictedPaths)
  const predictionMinutes = useSettingsStore((s) => s.predictionMinutes)

  const conflictHexes = useMemo(() => {
    const set = new Set<string>()
    for (const pair of conflictPairs) {
      set.add(pair.hexA)
      set.add(pair.hexB)
    }
    return set
  }, [conflictPairs])

  const selected = useMemo(() => {
    if (!showPredictedPaths || !selectedHex || conflictHexes.has(selectedHex)) {
      return { lines: EMPTY_LINES, dots: EMPTY_POINTS }
    }
    const pred = predictions.get(selectedHex)
    if (!pred) return { lines: EMPTY_LINES, dots: EMPTY_POINTS }

    const count = Math.floor((predictionMinutes * 60) / PREDICT_STEP_S) + 1
    const sliced = pred.points.slice(0, count)
    const line = lineFeature(sliced)
    const last = sliced[sliced.length - 1]
    return {
      lines: { type: 'FeatureCollection', features: line ? [line] : [] } as FeatureCollection<LineString>,
      dots: { type: 'FeatureCollection', features: last ? [dotFeature(last)] : [] } as FeatureCollection<Point>,
    }
  }, [showPredictedPaths, selectedHex, conflictHexes, predictions, predictionMinutes])

  const conflict = useMemo(() => {
    const lines: Feature<LineString>[] = []
    const dots: Feature<Point>[] = []
    for (const pair of conflictPairs) {
      const color = tierColor(pair.tier)
      for (const hex of [pair.hexA, pair.hexB]) {
        const pred = predictions.get(hex)
        if (!pred) continue
        const sliced = pred.points.filter((p) => p.tSec <= CONFLICT_HORIZON_S)
        const line = lineFeature(sliced, { tierColor: color })
        if (line) lines.push(line)
        const last = sliced[sliced.length - 1]
        if (last) dots.push(dotFeature(last, { tierColor: color }))
      }
    }
    return {
      lines: { type: 'FeatureCollection', features: lines } as FeatureCollection<LineString>,
      dots: { type: 'FeatureCollection', features: dots } as FeatureCollection<Point>,
    }
  }, [conflictPairs, predictions])

  return (
    <>
      <Source id="prediction-line" type="geojson" data={selected.lines}>
        <Layer
          id="prediction-line"
          type="line"
          paint={{
            'line-color': PREDICTION_LINE_COLOR,
            'line-width': 1.5,
            'line-opacity': 0.9,
          }}
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        />
      </Source>
      <Source id="prediction-dot" type="geojson" data={selected.dots}>
        <Layer
          id="prediction-dot"
          type="circle"
          paint={{
            'circle-radius': 3.5,
            'circle-color': '#ffffff',
            'circle-stroke-width': 1,
            'circle-stroke-color': '#0f172a',
          }}
        />
      </Source>
      <Source id="prediction-conflict-line" type="geojson" data={conflict.lines}>
        <Layer
          id="prediction-conflict-line"
          type="line"
          paint={{
            'line-color': ['get', 'tierColor'],
            'line-width': 2,
          }}
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        />
      </Source>
      <Source id="prediction-conflict-dot" type="geojson" data={conflict.dots}>
        <Layer
          id="prediction-conflict-dot"
          type="circle"
          paint={{
            'circle-radius': 3.5,
            'circle-color': ['get', 'tierColor'],
            'circle-stroke-width': 1,
            'circle-stroke-color': '#0f172a',
          }}
        />
      </Source>
    </>
  )
}
