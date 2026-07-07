import { useEffect } from 'react'
import { useAirportStore } from '../store/useAirportStore'
import { fetchDatis } from '../api/datis'

const POLL_INTERVAL_MS = 10 * 60 * 1_000  // ATIS updates ~every 30 min; poll at 10 min

// Primary-airport-only for now (reads/writes activeAirports[0]); Phase 6 runs
// one timer per active airport, writing each into atisByIcao.
export function useDatis() {
  const selectedAirport = useAirportStore((s) => s.selectedAirport)
  const setAtisForAirport = useAirportStore((s) => s.setAtisForAirport)

  useEffect(() => {
    if (!selectedAirport) return

    const icao = selectedAirport.icao

    const poll = () => {
      void fetchDatis(icao).then((info) => setAtisForAirport(icao, info))
    }

    poll()
    const id = setInterval(poll, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [selectedAirport?.icao, setAtisForAirport])
}
