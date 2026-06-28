import { useEffect } from 'react'
import { useAircraftStore } from '../store/useAircraftStore'
import { useProcedureStore } from '../store/useProcedureStore'
import { useAirportStore } from '../store/useAirportStore'
import { detectProceduresInUse } from '../geo/procedureDetection'

export function useProcedureDetection() {
  const lastPollMs = useAircraftStore((s) => s.lastPollMs)
  const selectedAirport = useAirportStore((s) => s.selectedAirport)
  const procedures = useProcedureStore((s) => s.procedures)
  const updateAutoDetection = useProcedureStore((s) => s.updateAutoDetection)

  useEffect(() => {
    if (!selectedAirport || procedures.length === 0 || lastPollMs === 0) return

    const aircraft = Array.from(useAircraftStore.getState().aircraftMap.values())
    const now = Date.now()

    const result = detectProceduresInUse(
      aircraft,
      procedures,
      selectedAirport.lat,
      selectedAirport.lon,
      selectedAirport.elevation,
      now,
    )

    updateAutoDetection(result.detected, now)
  }, [lastPollMs, selectedAirport, procedures, updateAutoDetection])
}
