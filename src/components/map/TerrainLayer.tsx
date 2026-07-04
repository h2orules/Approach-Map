import { Source, Layer } from 'react-map-gl'
import type { Expression } from 'mapbox-gl'
import { useSettingsStore } from '../../store/useSettingsStore'
import {
  TERRAIN_HYPSO_STOPS,
  TERRAIN_FILL_OPACITY,
  TERRAIN_CONTOUR_COLOR,
  CONTOUR_MAJOR_MIN_ZOOM,
  CONTOUR_ALL_MIN_ZOOM,
  CONTOUR_LABEL_MIN_ZOOM,
  PEAK_LABEL_MIN_ZOOM,
  FEET_PER_METER,
} from '../../config/constants'

// FAA-sectional-style terrain layer: hillshade relief + hypsometric elevation
// tinting + contour lines/labels (from Mapbox's terrain-DEM and terrain-v2
// tilesets), plus named-peak elevation labels (from streets-v8's
// natural_label source-layer).
//
// Tileset schema assumptions (mapbox.mapbox-terrain-v2, `contour` source-layer):
//   - Contour features are stacked/nested polygons (for the hypsometric fill)
//     and lines (for the contour strokes/labels), with an `ele` property in
//     METERS and an `index` property where 5/10 mark "major" (labeled)
//     contours and other values (commonly -1) mark minor contours.
// Tileset schema assumptions (mapbox.mapbox-streets-v8, `natural_label`
// source-layer):
//   - Peaks/summits are class `landform`, maki `mountain` or `volcano`, and
//     carry elevation as either `elevation_ft` or `elevation_m` depending on
//     tileset version — we read both defensively and fall back to whichever
//     is present, skipping features with neither.
// These were not re-verified against a live TileJSON in this environment (no
// VITE_MAPBOX_TOKEN was available); expressions are written defensively
// (coalesce/has-guards) so unexpected/missing fields degrade gracefully
// instead of rendering garbage (e.g. a "0 ft" peak label).
//
// This component is ALWAYS mounted (see AppMap) — visibility is toggled via
// `layout.visibility` on every layer below rather than mounting/unmounting
// the component. Runtime (imperative) layers stack in the order they are
// added, so mount/unmount would re-add these layers on top of whatever else
// had been added in the meantime. Declarative <Source>/<Layer> children are
// instead diffed by react-map-gl and keep their position (and get
// transparently re-added after base-style swaps), as long as the component
// itself stays mounted.

// TERRAIN_HYPSO_STOPS is [ft, color] ascending; Mapbox `ele` on the contour
// source-layer is in meters, so convert the stop thresholds ft -> m here.
// A `step` expression's first argument is the value for anything below the
// first stop, so use the first stop's color as the base and then step at
// each subsequent threshold.
const hypsoStepExpression: Expression = ['step', ['get', 'ele'], TERRAIN_HYPSO_STOPS[0][1]]
for (let i = 1; i < TERRAIN_HYPSO_STOPS.length; i++) {
  const [ft, color] = TERRAIN_HYPSO_STOPS[i]
  hypsoStepExpression.push(ft / FEET_PER_METER, color)
}

const MAJOR_CONTOUR_FILTER = ['match', ['get', 'index'], [5, 10], true, false]
const MINOR_CONTOUR_FILTER = ['!', ['match', ['get', 'index'], [5, 10], true, false]]

// Elevation in feet, rounded, from a meters-based `ele` property.
const CONTOUR_LABEL_TEXT: Expression = [
  'concat',
  ['to-string', ['round', ['*', ['get', 'ele'], FEET_PER_METER]]],
  ' ft',
]

const PEAK_LABEL_FILTER = [
  'all',
  ['==', ['get', 'class'], 'landform'],
  ['match', ['get', 'maki'], ['mountain', 'volcano'], true, false],
  ['any', ['has', 'elevation_ft'], ['has', 'elevation_m']],
]

const PEAK_ELEVATION_FT = [
  'coalesce',
  ['get', 'elevation_ft'],
  ['round', ['*', ['coalesce', ['get', 'elevation_m'], 0], FEET_PER_METER]],
]

const PEAK_LABEL_TEXT: Expression = [
  'concat',
  ['get', 'name'],
  '\n',
  ['to-string', PEAK_ELEVATION_FT],
  ' ft',
]

export function TerrainLayer() {
  const showTerrain = useSettingsStore((s) => s.showTerrain)
  const visibility = showTerrain ? 'visible' : 'none'

  return (
    <>
      <Source
        id="terrain-dem"
        type="raster-dem"
        url="mapbox://mapbox.mapbox-terrain-dem-v1"
        tileSize={512}
        maxzoom={14}
      >
        <Layer
          id="terrain-hillshade"
          type="hillshade"
          layout={{ visibility }}
          paint={{
            'hillshade-exaggeration': 0.25,
            'hillshade-shadow-color': '#5a4a3a',
          }}
        />
      </Source>

      <Source id="terrain-vec" type="vector" url="mapbox://mapbox.mapbox-terrain-v2">
        <Layer
          id="terrain-hypso-fill"
          type="fill"
          source-layer="contour"
          layout={{ visibility }}
          paint={{
            'fill-color': hypsoStepExpression,
            'fill-opacity': TERRAIN_FILL_OPACITY,
            'fill-antialias': false,
          }}
        />
        <Layer
          id="terrain-contour-major"
          type="line"
          source-layer="contour"
          filter={MAJOR_CONTOUR_FILTER}
          minzoom={CONTOUR_MAJOR_MIN_ZOOM}
          layout={{ visibility }}
          paint={{
            'line-color': TERRAIN_CONTOUR_COLOR,
            'line-width': 1,
            'line-opacity': 0.5,
          }}
        />
        <Layer
          id="terrain-contour-minor"
          type="line"
          source-layer="contour"
          filter={MINOR_CONTOUR_FILTER}
          minzoom={CONTOUR_ALL_MIN_ZOOM}
          layout={{ visibility }}
          paint={{
            'line-color': TERRAIN_CONTOUR_COLOR,
            'line-width': 0.4,
            'line-opacity': 0.3,
          }}
        />
        <Layer
          id="terrain-contour-label"
          type="symbol"
          source-layer="contour"
          filter={MAJOR_CONTOUR_FILTER}
          minzoom={CONTOUR_LABEL_MIN_ZOOM}
          layout={{
            visibility,
            'symbol-placement': 'line',
            'text-field': CONTOUR_LABEL_TEXT,
            'text-size': 10,
            'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          }}
          paint={{
            'text-color': TERRAIN_CONTOUR_COLOR,
            'text-halo-color': 'rgba(255,255,255,0.75)',
            'text-halo-width': 1.2,
          }}
        />
      </Source>

      <Source id="terrain-peaks" type="vector" url="mapbox://mapbox.mapbox-streets-v8">
        <Layer
          id="terrain-peak-label"
          type="symbol"
          source-layer="natural_label"
          filter={PEAK_LABEL_FILTER}
          minzoom={PEAK_LABEL_MIN_ZOOM}
          layout={{
            visibility,
            'text-field': PEAK_LABEL_TEXT,
            'text-size': 10,
            'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
            'text-anchor': 'top',
            'text-allow-overlap': false,
          }}
          paint={{
            'text-color': '#4a3a2a',
            'text-halo-color': 'rgba(255,255,255,0.85)',
            'text-halo-width': 1.2,
          }}
        />
      </Source>
    </>
  )
}
