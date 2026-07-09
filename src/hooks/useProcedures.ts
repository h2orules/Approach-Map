import { useEffect, useRef } from 'react'
import { useProcedureStore } from '../store/useProcedureStore'
import { useAirportStore, airportKey } from '../store/useAirportStore'
import { ensureAirport, getProceduresForAirport, useCifpStore } from '../services/cifpCache'
import { assignProcedureColors } from '../utils/colorScheme'

/**
 * Keeps the procedure store in sync with the SET of active airports: warms each
 * airport's CIFP data, merges its (per-slot-colored) procedures, and removes an
 * airport's procedures when it leaves the active set — all without disturbing
 * the other airports' detection state (see useProcedureStore's merge/remove
 * reducers). Race-safe: a slow warm that resolves after its airport was removed
 * (or the effect re-ran) is dropped.
 */
export function useProcedures() {
  const activeAirports = useAirportStore((s) => s.activeAirports)
  const cifpStatus = useCifpStore((s) => s.status)
  const mergeAirportProcedures = useProcedureStore((s) => s.mergeAirportProcedures)
  const removeAirportProcedures = useProcedureStore((s) => s.removeAirportProcedures)
  const setLoading = useProcedureStore((s) => s.setLoading)
  const setError = useProcedureStore((s) => s.setError)

  // Airport keys whose procedures are currently merged into the store.
  const loadedKeysRef = useRef<Set<string>>(new Set())
  // Was the CIFP index 'ready' on the previous run? An AIRAC-cycle refresh
  // (ready -> not-ready -> ready again) means every active airport's CIFP data
  // may have changed and must be re-warmed/re-merged. An ordinary add/remove of
  // one airport must NOT reprocess already-loaded airports: mergeAirportProcedures
  // clears an airport's userToggles/autoVisible/detectedHexes/aircraftAssignments/
  // detectionHistory whenever it's re-merged, so re-merging an untouched airport
  // on every unrelated airport-set change would silently wipe its live detection
  // state (and its `procedures` entries would also lose object identity for no
  // reason, churning any consumer that reads the array reference).
  const wasReadyRef = useRef(false)

  useEffect(() => {
    // The CIFP index being 'ready' only means the airport-key list is known;
    // individual airports still warm from IndexedDB on demand below.
    if (cifpStatus !== 'ready') {
      wasReadyRef.current = false
      if (activeAirports.length > 0) setLoading(true)
      return
    }

    let cancelled = false
    const activeKeys = new Set(activeAirports.map(airportKey))
    const freshLoad = !wasReadyRef.current
    wasReadyRef.current = true
    if (freshLoad) loadedKeysRef.current.clear()

    // Drop procedures for airports no longer active.
    for (const key of [...loadedKeysRef.current]) {
      if (!activeKeys.has(key)) {
        removeAirportProcedures(key)
        loadedKeysRef.current.delete(key)
      }
    }

    if (activeAirports.length === 0) {
      setError(null)
      setLoading(false)
      return
    }

    // Only (re-)warm airports that aren't already merged (or, on a fresh CIFP
    // load, all of them).
    const toWarm = activeAirports
      .map((airport, slot) => ({ airport, slot }))
      .filter(({ airport }) => freshLoad || !loadedKeysRef.current.has(airportKey(airport)))

    if (toWarm.length === 0) {
      // Every active airport is already merged successfully — nothing to do.
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)

    void (async () => {
      let anyEmpty = false
      await Promise.all(
        toWarm.map(async ({ airport, slot }) => {
          const key = airportKey(airport)
          const present = await ensureAirport(airport.icao)
          if (cancelled) return
          // The airport may have been removed while its warm was in flight.
          if (!useAirportStore.getState().activeAirports.some((a) => airportKey(a) === key)) return

          const cifpProcs = present ? getProceduresForAirport(airport.icao) : []
          if (cifpProcs.length === 0) {
            anyEmpty = true
            removeAirportProcedures(key)
            loadedKeysRef.current.delete(key)
            return
          }
          mergeAirportProcedures(key, assignProcedureColors(key, cifpProcs, slot))
          loadedKeysRef.current.add(key)
        }),
      )
      if (cancelled) return
      setError(anyEmpty ? 'No procedures found in CIFP data for this airport' : null)
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [activeAirports, cifpStatus, mergeAirportProcedures, removeAirportProcedures, setLoading, setError])

  return {}
}
