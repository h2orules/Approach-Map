import { useEffect } from 'react'
import { useSelectionStore } from '../store/useSelectionStore'
import { useAircraftStore } from '../store/useAircraftStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useProcedureStore, computeVisibility } from '../store/useProcedureStore'
import { useAirportStore, airportKey } from '../store/useAirportStore'
import { positionToMinFt, positionToMaxFt } from '../utils/altitudeFilter'

/**
 * Centralizes every condition under which the current selection (aircraft or
 * approach) should be cleared automatically, instead of scattering the logic
 * across the components that happen to own the underlying data:
 *
 *  - selected aircraft is pruned from the poll, or falls outside the
 *    altitude filter range
 *  - selected approach is no longer visible (user untoggle, revert-to-auto,
 *    or the 5-minute auto-hide)
 *  - the airport that OWNS the selected approach is removed from the active set
 *    (multi-airport: switching/removing one airport must not clear a selection
 *    belonging to another). Aircraft selections have no owning airport, so they
 *    persist across airport changes and clear only via the poll/altitude guards.
 */
export function useSelectionGuards() {
  const selected = useSelectionStore((s) => s.selected)
  const clear = useSelectionStore((s) => s.clear)

  const revision = useAircraftStore((s) => s.revision)
  const altFilterMin = useSettingsStore((s) => s.altFilterMin)
  const altFilterMax = useSettingsStore((s) => s.altFilterMax)

  const userToggles = useProcedureStore((s) => s.userToggles)
  const autoVisible = useProcedureStore((s) => s.autoVisible)
  const procedures = useProcedureStore((s) => s.procedures)

  const activeAirports = useAirportStore((s) => s.activeAirports)

  // Aircraft: gone from the poll, or outside the altitude filter window.
  useEffect(() => {
    if (selected?.kind !== 'aircraft') return
    const ac = useAircraftStore.getState().aircraftMap.get(selected.hex)
    if (!ac) {
      clear()
      return
    }
    if (ac.altBaro === 'ground') return
    const minFt = positionToMinFt(altFilterMin)
    const maxFt = positionToMaxFt(altFilterMax)
    if (ac.altBaro < minFt || ac.altBaro > maxFt) clear()
  }, [selected, revision, altFilterMin, altFilterMax, clear])

  // Approach: no longer visible per the user/auto toggle state.
  useEffect(() => {
    if (selected?.kind !== 'approach') return
    if (!computeVisibility(userToggles, autoVisible, selected.procedureId)) clear()
  }, [selected, userToggles, autoVisible, clear])

  // Approach: clear when its owning airport leaves the active set (the
  // procedure vanishes from the store), not on every airport change.
  useEffect(() => {
    if (selected?.kind !== 'approach') return
    const proc = procedures.find((p) => p.id === selected.procedureId)
    if (!proc) {
      clear()
      return
    }
    const ownerActive = activeAirports.some((a) => airportKey(a) === proc.icao.toUpperCase())
    if (!ownerActive) clear()
  }, [selected, procedures, activeAirports, clear])
}
