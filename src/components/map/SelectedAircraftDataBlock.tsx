import { useAircraftStore } from '../../store/useAircraftStore'
import { useSelectionStore, selectedHexOf } from '../../store/useSelectionStore'
import type { InterpolatedAircraft } from '../../types/aircraft'
import { DataBlock } from './DataBlock'

/** Renders the TRACON-style data block popup for the selected aircraft. */
export function SelectedAircraftDataBlock() {
  const hex = useSelectionStore((s) => selectedHexOf(s.selected))
  const aircraft = useAircraftStore((s) =>
    hex ? (s.aircraftMap.get(hex) as InterpolatedAircraft | undefined) : undefined,
  )
  const clearSelection = useSelectionStore((s) => s.clear)

  if (!hex || !aircraft) return null
  return <DataBlock aircraft={aircraft} onClose={clearSelection} />
}
