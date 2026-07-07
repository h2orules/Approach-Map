import { useEffect } from 'react'
import { useAirportStore, airportKey } from '../store/useAirportStore'
import { fetchDatis } from '../api/datis'

const POLL_INTERVAL_MS = 10 * 60 * 1_000  // ATIS updates ~every 30 min; poll at 10 min
// Stagger each airport's initial fetch so N airports don't all hit atis.info at
// once. The primary airport (index 0) fires immediately (0ms) — identical to
// the single-airport behavior.
const DATIS_STAGGER_MS = 1_500

// Runs one 10-minute poller per active airport, writing each result into
// atisByIcao. Keyed on the active-airport-key signature so adding/removing an
// airport re-establishes exactly the right set of timers.
export function useDatis() {
  const activeAirports = useAirportStore((s) => s.activeAirports)
  const setAtisForAirport = useAirportStore((s) => s.setAtisForAirport)

  const activeKeys = activeAirports.map(airportKey).sort().join(',')

  useEffect(() => {
    if (activeAirports.length === 0) return

    const timeouts: ReturnType<typeof setTimeout>[] = []
    const intervals: ReturnType<typeof setInterval>[] = []

    activeAirports.forEach((a, i) => {
      const key = airportKey(a)
      const poll = () => {
        void fetchDatis(a.icao).then((info) => setAtisForAirport(key, info))
      }
      const start = () => {
        poll()
        intervals.push(setInterval(poll, POLL_INTERVAL_MS))
      }
      if (i === 0) {
        start()
      } else {
        timeouts.push(setTimeout(start, i * DATIS_STAGGER_MS))
      }
    })

    return () => {
      for (const t of timeouts) clearTimeout(t)
      for (const iv of intervals) clearInterval(iv)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKeys, setAtisForAirport])
}
