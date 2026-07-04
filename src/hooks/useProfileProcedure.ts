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
 *  - or, when an aircraft is selected, the first visible APPROACH that
 *    currently has that aircraft's hex in its `detectedHexes`
 *  - or null (panel closed) otherwise
 *
 * Also kicks off the d-TPP metafile load (for amendment numbers) the moment
 * a procedure first becomes selected, since that fetch is only needed once
 * the profile panel is actually going to render.
 */
export function useProfileProcedure(): Procedure | null {
  const selected = useSelectionStore((s) => s.selected)
  const procedures = useProcedureStore((s) => s.procedures)
  const detectedHexes = useProcedureStore((s) => s.detectedHexes)
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
    const hex = selected.hex
    const p = procedures.find(
      (p) =>
        p.type === 'APPROACH' &&
        computeVisibility(userToggles, autoVisible, p.id) &&
        (detectedHexes[p.id]?.includes(hex) ?? false),
    )
    return p ?? null
  }, [selected, procedures, detectedHexes, userToggles, autoVisible])

  const prevProcRef = useRef<Procedure | null>(null)
  useEffect(() => {
    if (prevProcRef.current === null && procedure !== null && effectiveDate) {
      void ensureDtppLoaded(new Date(effectiveDate))
    }
    prevProcRef.current = procedure
  }, [procedure, effectiveDate])

  return procedure
}
