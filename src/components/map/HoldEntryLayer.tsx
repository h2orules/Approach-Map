import { useMemo } from 'react'
import { Source, Layer } from 'react-map-gl'
import type { Feature, FeatureCollection, LineString } from 'geojson'
import { usePathStore } from '../../store/usePathStore'
import { useProcedureStore, computeVisibility } from '../../store/useProcedureStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { HOLD_ENTRY_DASH } from '../../config/constants'

// Neutral slate for a context line when its procedure carries no color.
const CONTEXT_FALLBACK_COLOR = '#94a3b8'

/** procId is the part of the spec key before the `|fixId` suffix. */
function procIdOf(specKey: string): string {
  const i = specKey.indexOf('|')
  return i === -1 ? specKey : specKey.slice(0, i)
}

/**
 * Draws every in-flight hold-entry prediction (AIM 5-3-8 direct/teardrop/
 * parallel) as a dotted lead-in path, for all aircraft (not just the
 * selected one) — pilots and controllers alike want to see who's about to
 * enter a hold and how.
 *
 * When an entry belongs to a procedure that ISN'T currently visible on the
 * map, the white loop would otherwise float with no anchor. So we ALSO draw
 * that procedure's own lines thin (context) UNDER the entry path — including
 * its drawn hold racetrack, which lives in the same GeoJSON. Once the
 * procedure becomes visible/detected normally (ProcedureLayer draws it thick),
 * `computeVisibility` returns true and the extra context line drops out.
 */
export function HoldEntryLayer() {
  const showHoldEntries = useSettingsStore((s) => s.showHoldEntries)
  const holdEntries = usePathStore((s) => s.holdEntries)
  const procedures = useProcedureStore((s) => s.procedures)
  const userToggles = useProcedureStore((s) => s.userToggles)
  const autoVisible = useProcedureStore((s) => s.autoVisible)

  const fc = useMemo<FeatureCollection<LineString>>(() => {
    const features: Feature<LineString>[] = Array.from(holdEntries.values()).map((entry) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: entry.path },
      properties: { hex: entry.hex },
    }))
    return { type: 'FeatureCollection', features }
  }, [holdEntries])

  // Context lines: the LineString geometry of every not-currently-visible
  // procedure that owns an active hold entry, stamped with its own color.
  const contextFc = useMemo<FeatureCollection<LineString>>(() => {
    const procIds = new Set<string>()
    for (const entry of holdEntries.values()) {
      const id = procIdOf(entry.specKey)
      if (!computeVisibility(userToggles, autoVisible, id)) procIds.add(id)
    }
    if (procIds.size === 0) return { type: 'FeatureCollection', features: [] }

    const features: Feature<LineString>[] = []
    for (const proc of procedures) {
      if (!procIds.has(proc.id)) continue
      const color = proc.color || CONTEXT_FALLBACK_COLOR
      for (const f of proc.geojson.features) {
        if (f.geometry.type !== 'LineString') continue
        features.push({
          type: 'Feature',
          geometry: f.geometry,
          // __ctxLabel identifies the otherwise-fix-less thin line as its parent
          // approach (the sidebar ident, e.g. "I34C") along the line.
          properties: { __ctxColor: color, __ctxLabel: proc.name },
        })
      }
    }
    return { type: 'FeatureCollection', features }
  }, [holdEntries, procedures, userToggles, autoVisible])

  // Off by default — a display toggle (PathControls "HOLD"). The engine keeps
  // computing entries regardless, so toggling on shows them immediately.
  if (!showHoldEntries) return null

  return (
    <>
      {/* Context: the parent procedure drawn thin, only while it's hidden, so
          the entry loop has something to anchor to. Rendered first → below the
          entry path. */}
      <Source id="hold-entry-context" type="geojson" data={contextFc}>
        <Layer
          id="hold-entry-context-line"
          type="line"
          paint={{
            'line-color': ['coalesce', ['get', '__ctxColor'], CONTEXT_FALLBACK_COLOR],
            'line-width': 1,
            'line-opacity': 0.5,
          }}
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        />
        {/* Identify the fix-less context line with its parent approach's ident,
            placed along the line so the thin lines aren't a mystery. */}
        <Layer
          id="hold-entry-context-label"
          type="symbol"
          layout={{
            'symbol-placement': 'line',
            'symbol-spacing': 250,
            'text-field': ['coalesce', ['get', '__ctxLabel'], ''],
            'text-size': 10,
            'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
            'text-allow-overlap': false,
            'text-keep-upright': true,
          }}
          paint={{
            'text-color': ['coalesce', ['get', '__ctxColor'], CONTEXT_FALLBACK_COLOR],
            'text-halo-color': 'rgba(10,15,20,0.9)',
            'text-halo-width': 1.4,
            'text-opacity': 0.9,
          }}
        />
      </Source>

      <Source id="hold-entry" type="geojson" data={fc}>
        <Layer
          id="hold-entry-line"
          type="line"
          paint={{
            'line-color': '#ffffff',
            'line-width': 1.5,
            'line-opacity': 0.7,
            'line-dasharray': HOLD_ENTRY_DASH,
          }}
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        />
      </Source>
    </>
  )
}
