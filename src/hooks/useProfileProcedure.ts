import { useEffect, useMemo, useRef } from 'react'
import { useSelectionStore } from '../store/useSelectionStore'
import { useProcedureStore, computeVisibility } from '../store/useProcedureStore'
import { useAircraftStore } from '../store/useAircraftStore'
import { useCifpStore } from '../services/cifpCache'
import { ensureDtppLoaded } from '../services/dtppMetafile'
import { findFlownSegmentMatch } from '../geo/flownSegment'
import type { Procedure } from '../types/procedure'

/**
 * Resolves the procedure that the FAA-plate vertical-profile panel should
 * show for the current selection:
 *
 *  - an explicitly-selected approach (`selected.kind === 'approach'`)
 *  - or, when an aircraft is selected, the first visible APPROACH that
 *    currently has that aircraft's hex in its `detectedHexes` snapshot
 *  - or, when the aircraft isn't in any visible approach's `detectedHexes`
 *    (the detection engine's strict gates — 0.25nm cross-track, altitude,
 *    45° direction — plus parallel-runway/ATIS dedup can drop the aircraft
 *    or attribute it to a different procedure id between polls), fall back
 *    to the same looser (~2nm) proximity+direction matcher that
 *    `FlownSegmentLayer` uses for the magenta flown-segment highlight, so
 *    the profile panel opens whenever that highlight does
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
  // Not read directly below — bumped only on poll, in the same store update
  // that refreshes aircraft position. Included as a dep so the flown-segment
  // fallback recomputes in lockstep with `detectedHexes` (also poll-driven),
  // rather than going stale between polls.
  const aircraftRevision = useAircraftStore((s) => s.revision)
  const effectiveDate = useCifpStore((s) => s.effectiveDate)

  // The approach currently shown for a selected aircraft, latched so it doesn't
  // flip between sibling approaches (ILS / RNP Y / RNP Z to the same runway all
  // overlie the final approach course, so "nearest segment" — and the detection
  // snapshot — can hand the aircraft to a different one each poll, which used to
  // make the whole profile change on any re-render, e.g. a map zoom/pan).
  const latchRef = useRef<{ hex: string; procId: string } | null>(null)

  const procedure = useMemo<Procedure | null>(() => {
    if (!selected) return null

    if (selected.kind === 'approach') {
      const p = procedures.find((p) => p.id === selected.procedureId && p.type === 'APPROACH')
      return p ?? null
    }

    // selected.kind === 'aircraft'
    const hex = selected.hex
    const visibleApproaches = procedures.filter(
      (p) => p.type === 'APPROACH' && computeVisibility(userToggles, autoVisible, p.id),
    )
    if (visibleApproaches.length === 0) return null

    const ac = useAircraftStore.getState().aircraftMap.get(hex)

    // Keep showing the latched approach as long as the aircraft is still flying
    // it (still visible AND still a flown-segment match). Only re-resolve once
    // it no longer applies — this stabilizes the profile against poll-to-poll
    // "nearest approach" churn without freezing onto an approach the aircraft
    // has actually left.
    if (latchRef.current?.hex === hex && ac) {
      const latched = visibleApproaches.find((p) => p.id === latchRef.current!.procId)
      if (latched && findFlownSegmentMatch(ac.interpLat, ac.interpLon, ac.track, [latched])) {
        return latched
      }
    }

    const detected = visibleApproaches.find((p) => detectedHexes[p.id]?.includes(hex) ?? false)
    if (detected) return detected

    // Fallback: mirror the magenta flown-segment match (FlownSegmentLayer /
    // src/geo/flownSegment.ts) so the profile panel opens whenever that
    // highlight does, even when the stricter detection snapshot missed or
    // reassigned this aircraft.
    if (!ac) return null
    const match = findFlownSegmentMatch(ac.interpLat, ac.interpLon, ac.track, visibleApproaches)
    return match?.procedure ?? null
  }, [selected, procedures, detectedHexes, userToggles, autoVisible, aircraftRevision])

  // Track the latched aircraft→approach pairing across polls.
  useEffect(() => {
    if (selected?.kind === 'aircraft' && procedure) {
      latchRef.current = { hex: selected.hex, procId: procedure.id }
    } else {
      latchRef.current = null
    }
  }, [selected, procedure])

  const prevProcRef = useRef<Procedure | null>(null)
  useEffect(() => {
    if (prevProcRef.current === null && procedure !== null && effectiveDate) {
      void ensureDtppLoaded(new Date(effectiveDate))
    }
    prevProcRef.current = procedure
  }, [procedure, effectiveDate])

  return procedure
}
