import { useEffect, useMemo, useRef } from 'react'
import { useAircraftStore } from '../store/useAircraftStore'
import { useProcedureStore } from '../store/useProcedureStore'
import { useAirportStore, airportKey } from '../store/useAirportStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { positionToMinFt, positionToMaxFt } from '../utils/altitudeFilter'
import type { AirportContext } from '../geo/procedureMatch'
import {
  initialDetectionState,
  reduceDetection,
  pruneDetectionState,
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
// Runs detection across every active airport. Each procedure is matched against
// its OWN airport's context (position + elevation), looked up by proc.icao, so a
// second airport's altitude gating never uses the wrong field's elevation.
export function useProcedureDetection() {
  const lastPollMs = useAircraftStore((s) => s.lastPollMs)
  const activeAirports = useAirportStore((s) => s.activeAirports)
  const atisByIcao = useAirportStore((s) => s.atisByIcao)
  const procedures = useProcedureStore((s) => s.procedures)
  const applyDetection = useProcedureStore((s) => s.applyDetection)
  const altFilterMin = useSettingsStore((s) => s.altFilterMin)
  const altFilterMax = useSettingsStore((s) => s.altFilterMax)

  const stateRef = useRef<DetectionState>(initialDetectionState())

  // Per-airport detection contexts keyed by airportKey (=== uppercase proc.icao).
  const ctxByKey = useMemo(
    () =>
      Object.fromEntries(
        activeAirports.map((a): [string, AirportContext] => [
          airportKey(a),
          { lat: a.lat, lon: a.lon, elevationFt: a.elevation },
        ]),
      ),
    [activeAirports],
  )

  // Surgical prune (not a full reset) when the active-airport set or procedure
  // set changes: keep every still-present procedure's tracks/assignments, drop
  // only those whose procedure id is gone. Adding an airport introduces new ids
  // (nothing pruned, existing tracks survive); removing one drops exactly that
  // airport's ids; an AIRAC refresh keeps ids stable (`${icao}-${type}-${name}`)
  // so tracks persist across the cycle boundary.
  const activeKeys = activeAirports.map(airportKey).sort().join(',')
  useEffect(() => {
    const ids = new Set(procedures.map((p) => p.id))
    stateRef.current = pruneDetectionState(stateRef.current, ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKeys, procedures])

  useEffect(() => {
    if (activeAirports.length === 0 || procedures.length === 0 || lastPollMs === 0) return

    const minFt = positionToMinFt(altFilterMin)
    const maxFt = positionToMaxFt(altFilterMax)
    const aircraft = Array.from(useAircraftStore.getState().aircraftMap.values()).filter(
      (ac) =>
        ac.altBaro !== 'ground' &&
        (ac.altBaro as number) >= minFt &&
        (ac.altBaro as number) <= maxFt,
    )
    const nowMs = Date.now()

    const { state, events } = reduceDetection(
      stateRef.current,
      { nowMs, aircraft },
      procedures,
      ctxByKey,
      atisByIcao,
      DEFAULT_DETECTION_CONFIG,
    )
    stateRef.current = state

    const activity = deriveProcedureActivity(state)
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
      console.log(`[detect] ${activeAirports.length}apt  ${line}`)
    }
  }, [
    lastPollMs,
    activeAirports,
    atisByIcao,
    procedures,
    applyDetection,
    altFilterMin,
    altFilterMax,
    ctxByKey,
  ])
}
