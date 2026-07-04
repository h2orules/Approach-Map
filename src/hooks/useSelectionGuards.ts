import { useEffect } from 'react'
import { useSelectionStore } from '../store/useSelectionStore'
import { useAircraftStore } from '../store/useAircraftStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useProcedureStore } from '../store/useProcedureStore'
import { useAirportStore } from '../store/useAirportStore'
import { positionToMinFt, positionToMaxFt } from '../utils/altitudeFilter'

/**
 * Pure mirror of `useProcedureStore.isVisible` that takes the raw maps
 * instead of the store instance, so callers that already subscribed to
 * `userToggles`/`autoVisible` (e.g. to build a render list) don't need a
 * second subscription just to resolve one id.
 */
export function computeVisibility(
  userToggles: Record<string, boolean | undefined>,
  autoVisible: Record<string, boolean>,
  id: string,
): boolean {
  const userToggle = userToggles[id]
  if (userToggle !== undefined) return userToggle
  return autoVisible[id] ?? false
}

/**
 * Centralizes every condition under which the current selection (aircraft or
 * approach) should be cleared automatically, instead of scattering the logic
 * across the components that happen to own the underlying data:
 *
 *  - selected aircraft is pruned from the poll, or falls outside the
 *    altitude filter range
 *  - selected approach is no longer visible (user untoggle, revert-to-auto,
 *    or the 5-minute auto-hide)
 *  - the selected airport changes
 */
export function useSelectionGuards() {
  const selected = useSelectionStore((s) => s.selected)
  const clear = useSelectionStore((s) => s.clear)

  const revision = useAircraftStore((s) => s.revision)
  const altFilterMin = useSettingsStore((s) => s.altFilterMin)
  const altFilterMax = useSettingsStore((s) => s.altFilterMax)

  const userToggles = useProcedureStore((s) => s.userToggles)
  const autoVisible = useProcedureStore((s) => s.autoVisible)

  const airportIcao = useAirportStore((s) => s.selectedAirport?.icao)

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

  // Airport switch always clears whatever was selected at the old airport.
  useEffect(() => {
    clear()
  }, [airportIcao, clear])
}
