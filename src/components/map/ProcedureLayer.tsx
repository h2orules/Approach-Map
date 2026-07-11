import { useMemo } from 'react'
import { Source, Layer } from 'react-map-gl'
import type { FeatureCollection } from 'geojson'
import type { Procedure } from '../../types/procedure'
import { useProcedureStore } from '../../store/useProcedureStore'
import { useAircraftStore } from '../../store/useAircraftStore'
import { useAirportStore } from '../../store/useAirportStore'
import { useSelectionStore } from '../../store/useSelectionStore'

interface Props {
  procedure: Procedure
}

function bearingDelta(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

function runwayHeading(rwy: string): number {
  return parseInt(rwy.slice(0, 2), 10) * 10
}

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

/**
 * For SIDs that serve more than one departure flow direction (e.g. BANGR9 at
 * KSEA has separate RW16-series and RW34-series transitions, each running
 * independently out to the fix where they converge — the convergence portion
 * itself lives in a separate non-runway transition, so dashing only the
 * runway-specific features already stops exactly at that fix with no extra
 * truncation logic needed): identify which flow direction is NOT currently in
 * use, so its runway-specific legs can be
 * rendered dimmer/dashed. ATIS-reported departure runways are authoritative
 * when they disambiguate this SID's directions (same ATIS-informed pattern as
 * approach priority, src/geo/approachPriority.ts). Otherwise fall back to the
 * track heading of aircraft the detection engine has already confirmed as
 * flying this specific procedure (useProcedureStore.detectedHexes) — not just
 * any airborne aircraft, so unrelated traffic elsewhere can't false-positive a
 * direction as active.
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
    if (m) rwHeadings.set(tid, parseInt(m[1], 10) * 10)
  }

  // Need at least two RW transitions to potentially have opposite directions.
  if (rwHeadings.size <= 1) return null

  // Check that the headings actually differ (i.e. this SID serves two directions).
  const headings = [...rwHeadings.values()]
  const allSameDir = headings.every((h) => bearingDelta(h, headings[0]) <= 45)
  if (allSameDir) return null

  const buildInactiveSet = (activeHeadings: number[]): Set<string> => {
    const inactive = new Set<string>()
    for (const [tid, heading] of rwHeadings) {
      const active = activeHeadings.some((ah) => bearingDelta(ah, heading) <= 45)
      if (!active) inactive.add(tid)
    }
    return inactive
  }

  // Primary: ATIS-reported departure runways, when they disambiguate this
  // SID's directions (i.e. at least one reported runway matches one of this
  // SID's runway headings — a mismatch means ATIS is talking about a runway
  // complex this SID doesn't serve, so it can't tell us anything here).
  const atisDepRunways = useAirportStore.getState().atisInfo?.depRunways ?? []
  const atisHeadings = atisDepRunways.map(runwayHeading)
  const atisDisambiguates =
    atisHeadings.length > 0 && headings.some((h) => atisHeadings.some((ah) => bearingDelta(ah, h) <= 45))

  if (atisDisambiguates) {
    const inactive = buildInactiveSet(atisHeadings)
    if (inactive.size === 0 || inactive.size === rwHeadings.size) return null
    return inactive
  }

  // Fallback: track heading of aircraft the detection engine has already
  // confirmed as flying this SID.
  const hexes = useProcedureStore.getState().detectedHexes[procedure.id] ?? []
  if (hexes.length === 0) return null // no confirmed traffic yet — show everything solid

  const aircraftMap = useAircraftStore.getState().aircraftMap
  const tracks = hexes
    .map((hex) => aircraftMap.get(hex))
    .filter((ac): ac is NonNullable<typeof ac> => !!ac && ac.altBaro !== 'ground')
    .map((ac) => ac.track)
  if (tracks.length === 0) return null

  const inactive = buildInactiveSet(tracks)
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
              'line-width': 2,
              // Near-zero dash length + round cap = a round dot rather than a
              // short dash; a wide gap keeps the dots clearly separated
              // instead of reading as a slightly-textured solid line.
              'line-dasharray': [0.01, 2.5],
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
        {/* Feeder transitions (initial fix → common IAF/IF, no MAP): drawn thin
            regardless of detection so several feeders fanning into one approach
            don't clutter the map. The specific feeder an aircraft is flying is
            thickened by AutoActiveSegmentsLayer / FlownSegmentLayer on top. */}
        <Layer
          id={`proc-feeder-${procedure.id}`}
          type="line"
          filter={['==', ['get', 'feeder'], true]}
          paint={{
            'line-color': lineColor,
            'line-width': 1.5 + (isSelected ? 1 : 0),
            'line-opacity': 0.8,
          }}
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        />
        {/* Inbound path (final segment) + holds: solid (procedure-turn barbs and
            the thin feeders above are drawn separately). */}
        <Layer
          id={`proc-line-${procedure.id}`}
          type="line"
          filter={[
            'all',
            ['==', ['get', 'segment'], 'transition'],
            ['!=', ['get', 'kind'], 'pt'],
            ['!=', ['get', 'feeder'], true],
          ]}
          paint={{
            'line-color': lineColor,
            'line-width': baseWidth,
            'line-opacity': 0.9,
          }}
          layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        />
        {/* Procedure-turn barb: slightly wider than the base line so the 45°
            tick stays legible where the outbound leg hides under the final
            approach course and the tick crosses hold/centerline geometry. */}
        <Layer
          id={`proc-pt-${procedure.id}`}
          type="line"
          filter={['==', ['get', 'kind'], 'pt']}
          paint={{
            'line-color': lineColor,
            'line-width': baseWidth + 1,
            'line-opacity': 0.95,
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
