import { useEffect } from 'react'
import { useProcedureStore } from '../store/useProcedureStore'
import { useAirportStore } from '../store/useAirportStore'
import { ensureAirport, getProceduresForAirport, useCifpStore } from '../services/cifpCache'
import { nextProcedureColor, resetColorCounters } from '../utils/colorScheme'

export function useProcedures() {
  const selectedAirport = useAirportStore((s) => s.selectedAirport)
  const cifpStatus = useCifpStore((s) => s.status)
  const setProcedures = useProcedureStore((s) => s.setProcedures)
  const setLoading = useProcedureStore((s) => s.setLoading)
  const setError = useProcedureStore((s) => s.setError)

  useEffect(() => {
    if (!selectedAirport) return

    if (cifpStatus !== 'ready') {
      setLoading(true)
      return
    }

    let cancelled = false
    setLoading(true)

    void (async () => {
      // The CIFP index being 'ready' only means the list of airport keys is
      // known — this airport's procedure data may still need to be warmed
      // into memory from IndexedDB (see cifpCache.ts's per-airport layout).
      await ensureAirport(selectedAirport.icao)
      if (cancelled) return

      const cifpProcs = getProceduresForAirport(selectedAirport.icao)
      resetColorCounters()

      if (cifpProcs.length === 0) {
        setProcedures([])
        setError('No procedures found in CIFP data for this airport')
        setLoading(false)
        return
      }

      const colored = cifpProcs.map((p) => ({ ...p, color: nextProcedureColor(p.type) }))
      setProcedures(colored)
      setError(null)
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [selectedAirport, cifpStatus, setProcedures, setLoading, setError])

  return {}
}
