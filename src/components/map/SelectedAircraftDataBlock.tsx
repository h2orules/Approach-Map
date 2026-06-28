import { useAircraftStore } from '../../store/useAircraftStore'
import type { InterpolatedAircraft } from '../../types/aircraft'
import { DataBlock } from './DataBlock'

/** Renders the TRACON-style data block popup for the selected aircraft. */
export function SelectedAircraftDataBlock() {
  const hex = useAircraftStore((s) => s.selectedHex)
  const aircraft = useAircraftStore((s) =>
    hex ? (s.aircraftMap.get(hex) as InterpolatedAircraft | undefined) : undefined,
  )
  const setSelectedHex = useAircraftStore((s) => s.setSelectedHex)

  if (!hex || !aircraft) return null
  return <DataBlock aircraft={aircraft} onClose={() => setSelectedHex(null)} />
}
