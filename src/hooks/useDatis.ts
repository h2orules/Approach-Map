import { useEffect } from 'react'
import { useAirportStore } from '../store/useAirportStore'
import { fetchDatis } from '../api/datis'

const POLL_INTERVAL_MS = 10 * 60 * 1_000  // ATIS updates ~every 30 min; poll at 10 min

export function useDatis() {
  const selectedAirport = useAirportStore((s) => s.selectedAirport)
  const setAtisInfo = useAirportStore((s) => s.setAtisInfo)

  useEffect(() => {
    if (!selectedAirport) {
      setAtisInfo(null)
      return
    }

    const icao = selectedAirport.icao

    const poll = () => {
      void fetchDatis(icao).then((info) => setAtisInfo(info))
    }

    poll()
    const id = setInterval(poll, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [selectedAirport?.icao, setAtisInfo])
}
