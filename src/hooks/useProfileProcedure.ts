import { useEffect, useMemo, useRef } from 'react'
import { useSelectionStore } from '../store/useSelectionStore'
import { useProcedureStore, computeVisibility } from '../store/useProcedureStore'
import { useCifpStore } from '../services/cifpCache'
import { ensureDtppLoaded } from '../services/dtppMetafile'
import type { Procedure } from '../types/procedure'

/**
 * Resolves the procedure that the FAA-plate vertical-profile panel should
 * show for the current selection:
 *
 *  - an explicitly-selected approach (`selected.kind === 'approach'`)
 *  - or, when an aircraft is selected, the visible APPROACH the detection
 *    engine has assigned that hex to (`aircraftAssignments[hex]`, sticky by
 *    construction — see `detectionMachine.ts` — so no latch is needed here)
 *  - or null (panel closed) otherwise
 *
 * Note: assignment requires the detection engine's sustained-match
 * confirmation, so the panel opens ~10-15s after an aircraft actually starts
 * flying the approach. Accepted trade-off for eliminating flip-flop between
 * sibling approaches (ILS / RNP Y / RNP Z to the same runway).
 *
 * Also kicks off the d-TPP metafile load (for amendment numbers) the moment
 * a procedure first becomes selected, since that fetch is only needed once
 * the profile panel is actually going to render.
 */
export function useProfileProcedure(): Procedure | null {
  const selected = useSelectionStore((s) => s.selected)
  const procedures = useProcedureStore((s) => s.procedures)
  const aircraftAssignments = useProcedureStore((s) => s.aircraftAssignments ?? {})
  const userToggles = useProcedureStore((s) => s.userToggles)
  const autoVisible = useProcedureStore((s) => s.autoVisible)
  const effectiveDate = useCifpStore((s) => s.effectiveDate)

  const procedure = useMemo<Procedure | null>(() => {
    if (!selected) return null

    if (selected.kind === 'approach') {
      const p = procedures.find((p) => p.id === selected.procedureId && p.type === 'APPROACH')
      return p ?? null
    }

    // selected.kind === 'aircraft'
    const procId = aircraftAssignments[selected.hex]
    if (!procId) return null
    const p = procedures.find((p) => p.id === procId && p.type === 'APPROACH')
    if (!p || !computeVisibility(userToggles, autoVisible, p.id)) return null
    return p
  }, [selected, procedures, aircraftAssignments, userToggles, autoVisible])

  const prevProcRef = useRef<Procedure | null>(null)
  useEffect(() => {
    if (prevProcRef.current === null && procedure !== null && effectiveDate) {
      void ensureDtppLoaded(new Date(effectiveDate))
    }
    prevProcRef.current = procedure
  }, [procedure, effectiveDate])

  return procedure
}
