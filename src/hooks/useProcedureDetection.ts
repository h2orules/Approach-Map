import { useEffect, useRef } from 'react'
import { useAircraftStore } from '../store/useAircraftStore'
import { useProcedureStore } from '../store/useProcedureStore'
import { useAirportStore } from '../store/useAirportStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { positionToMinFt, positionToMaxFt } from '../utils/altitudeFilter'
import {
  initialDetectionState,
  reduceDetection,
  deriveProcedureActivity,
  DEFAULT_DETECTION_CONFIG,
  type DetectionState,
} from '../geo/detectionMachine'

/**
 * Runs the time-confirmed detection machine after each ADS-B poll: builds an
 * airborne, alt-filtered aircraft snapshot, reduces it into persistent
 * per-(hex, procedure) tracks, derives per-procedure activity, and pushes the
 * result into the procedure store. All matching/dedup/hysteresis policy lives
 * in the pure reducer (`src/geo/detectionMachine.ts`); this hook is only glue.
 */
export function useProcedureDetection() {
  const lastPollMs = useAircraftStore((s) => s.lastPollMs)
  const selectedAirport = useAirportStore((s) => s.selectedAirport)
  const atisInfo = useAirportStore((s) => s.atisInfo)
  const procedures = useProcedureStore((s) => s.procedures)
  const applyDetection = useProcedureStore((s) => s.applyDetection)
  const altFilterMin = useSettingsStore((s) => s.altFilterMin)
  const altFilterMax = useSettingsStore((s) => s.altFilterMax)

  const stateRef = useRef<DetectionState>(initialDetectionState())

  // Reset detection state when the airport or procedure set changes — stale
  // tracks from a different airport/AIRAC cycle must not carry over.
  const icao = selectedAirport?.icao ?? null
  useEffect(() => {
    stateRef.current = initialDetectionState()
  }, [icao, procedures])

  useEffect(() => {
    if (!selectedAirport || procedures.length === 0 || lastPollMs === 0) return

    const minFt = positionToMinFt(altFilterMin)
    const maxFt = positionToMaxFt(altFilterMax)
    const aircraft = Array.from(useAircraftStore.getState().aircraftMap.values()).filter(
      (ac) =>
        ac.altBaro !== 'ground' &&
        (ac.altBaro as number) >= minFt &&
        (ac.altBaro as number) <= maxFt,
    )
    const nowMs = Date.now()

    const ctx = {
      lat: selectedAirport.lat,
      lon: selectedAirport.lon,
      elevationFt: selectedAirport.elevation,
    }

    const { state, events } = reduceDetection(
      stateRef.current,
      { nowMs, aircraft },
      procedures,
      ctx,
      atisInfo,
      DEFAULT_DETECTION_CONFIG,
    )
    stateRef.current = state

    const activity = deriveProcedureActivity(state, procedures)
    applyDetection(activity, state.assignments, nowMs)

    if (import.meta.env.DEV && events.length) {
      const byId = new Map(procedures.map((p) => [p.id, p]))
      const name = (id: string) => byId.get(id)?.name ?? id
      const line = events
        .map((e) =>
          e.type === 'assigned'
            ? `assign ${e.hex}→${name(e.procId)}`
            : `${e.type} ${e.hex} ${name(e.procId)}`,
        )
        .join('  |  ')
      console.log(`[detect] ${selectedAirport.icao}  ${line}`)
    }
  }, [lastPollMs, selectedAirport, procedures, atisInfo, applyDetection, altFilterMin, altFilterMax])
}
