import { useMemo } from 'react'
import { Source, Layer } from 'react-map-gl'
import type { FeatureCollection } from 'geojson'
import type { Procedure } from '../../types/procedure'
import { useProcedureStore } from '../../store/useProcedureStore'
import { useAircraftStore } from '../../store/useAircraftStore'
import { useSelectionStore } from '../../store/useSelectionStore'

interface Props {
  procedure: Procedure
}

function bearingDelta(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

/**
 * For SID procedures: identify RW* transition features whose runway direction
 * does not match any currently flying aircraft. Returns the set of transitionIds
 * to render as dotted, or null if no dashing is needed.
 */
function inactiveRwTransitions(procedure: Procedure): Set<string> | null {
  if (procedure.type !== 'SID') return null

  // Collect every RW* transitionId present in the GeoJSON, mapped to its heading.
  const rwHeadings = new Map<string, number>() // transitionId → heading °
  for (const f of procedure.geojson.features) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tid: string | undefined = (f as any).properties?.transitionId
    if (!tid) continue
    const m = tid.match(/^RW(\d{2})/)
    if (m) rwHeadings.set(tid, parseInt(m[1]) * 10)
  }

  // Need at least two RW transitions to potentially have opposite directions.
  if (rwHeadings.size <= 1) return null

  // Check that the headings actually differ (i.e. this SID serves two directions).
  const headings = [...rwHeadings.values()]
  const allSameDir = headings.every((h) => bearingDelta(h, headings[0]) <= 45)
  if (allSameDir) return null

  // Which runway directions have aircraft flying them?
  const aircraft = Array.from(useAircraftStore.getState().aircraftMap.values()).filter(
    (ac) => ac.altBaro !== 'ground',
  )
  if (aircraft.length === 0) return null // no data yet — show everything solid

  const inactive = new Set<string>()
  for (const [tid, heading] of rwHeadings) {
    const active = aircraft.some((ac) => bearingDelta(ac.track, heading) <= 45)
    if (!active) inactive.add(tid)
  }

  // If everything is active (or nothing is active) there's nothing to dash.
  if (inactive.size === 0 || inactive.size === rwHeadings.size) return null
  return inactive
}

export function ProcedureLayer({ procedure }: Props) {
  const isAutoShown = useProcedureStore((s) => s.autoShownIds.has(procedure.id))
  // Re-evaluate opposite-direction transitions on each ADS-B poll.
  const revision = useAircraftStore((s) => s.revision)
  const isSelected = useSelectionStore(
    (s) => s.selected?.kind === 'approach' && s.selected.procedureId === procedure.id,
  )

  const lineColor = procedure.color
  // Approaches stay thick when auto-detected; SIDs/STARs are always thin here
  // (AutoActiveSegmentsLayer thickens their active legs instead). Selection
  // adds a small emphasis bump on top of whichever base width applies.
  const baseWidth = (procedure.type === 'APPROACH' && isAutoShown ? 3 : 1.5) + (isSelected ? 1.5 : 0)

  // Split GeoJSON for SIDs: inactive RW transitions → separate dotted source.
  const { mainGeojson, inactiveGeojson } = useMemo(() => {
    const inactive = inactiveRwTransitions(procedure)
    if (!inactive) return { mainGeojson: procedure.geojson, inactiveGeojson: EMPTY_FC }

    const main: FeatureCollection = {
      type: 'FeatureCollection',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      features: procedure.geojson.features.filter((f) => !inactive.has((f as any).properties?.transitionId)),
    }
    const inactiveFc: FeatureCollection = {
      type: 'FeatureCollection',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      features: procedure.geojson.features.filter((f) => inactive.has((f as any).properties?.transitionId)),
    }
    return { mainGeojson: main, inactiveGeojson: inactiveFc }
  }, [procedure, revision]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* Opposite-direction SID runway transitions: dotted, rendered below so
          the solid active transitions always appear on top. */}
      {procedure.type === 'SID' && (
        <Source id={`proc-inactive-${procedure.id}`} type="geojson" data={inactiveGeojson}>
          <Layer
            id={`proc-inactive-line-${procedure.id}`}
            type="line"
            paint={{
              'line-color': lineColor,
              'line-width': 1.5,
              'line-dasharray': [1, 2.5],
              'line-opacity': 0.5,
            }}
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
          />
        </Source>
      )}

      <Source id={`proc-${procedure.id}`} type="geojson" data={mainGeojson}>
        {/* Invisible wide hit-target for click selection — approaches only.
            Must come first so it renders (and hit-tests) below the visible
            lines but still registers in interactiveLayerIds queries. */}
        {procedure.type === 'APPROACH' && (
          <Layer
            id={`proc-hit-${procedure.id}`}
            type="line"
            paint={{
              'line-width': 14,
              'line-color': '#000',
              'line-opacity': 0.001,
            }}
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
          />
        )}
        {/* Inbound path + holds + procedure turns: solid */}
        <Layer
          id={`proc-line-${procedure.id}`}
          type="line"
          filter={['==', ['get', 'segment'], 'transition']}
          paint={{
            'line-color': lineColor,
            'line-width': baseWidth,
            'line-opacity': 0.9,
          }}
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        />
        {/* Missed approach: dash-dot-dash, always thin. */}
        <Layer
          id={`proc-missed-${procedure.id}`}
          type="line"
          filter={['==', ['get', 'segment'], 'missed']}
          paint={{
            'line-color': lineColor,
            'line-width': 1.5,
            'line-opacity': 0.85,
            'line-dasharray': [3, 1.5, 0.5, 1.5],
          }}
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        />
      </Source>
    </>
  )
}
