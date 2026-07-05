import { useEffect } from 'react'
import { useAircraftStore } from '../store/useAircraftStore'
import { lookupRoutes } from '../api/routes'

/**
 * After each ADS-B poll, batches an origin/destination lookup (adsb.lol
 * routeset, falling back to adsbdb for confirmed misses) for aircraft that
 * don't already have route data. ADS-B Exchange's own from/to fields are
 * trusted when present — this hook only fills gaps, and only stores results
 * adsb.lol's server-side plausibility check didn't reject.
 */
export function useRouteEnrichment() {
  const revision = useAircraftStore((s) => s.revision)

  useEffect(() => {
    const { getAll, setRouteData } = useAircraftStore.getState()
    const candidates = getAll().filter(
      (ac) => !ac.origin && !ac.destination && ac.flight && ac.flight.toUpperCase() !== ac.hex.toUpperCase(),
    )
    if (candidates.length === 0) return

    const hexByCallsign = new Map<string, string>()
    const queries = candidates.map((ac) => {
      const callsign = ac.flight.trim().toUpperCase()
      hexByCallsign.set(callsign, ac.hex)
      return { callsign, lat: ac.interpLat, lon: ac.interpLon }
    })

    lookupRoutes(queries).then((results) => {
      for (const [callsign, route] of results) {
        if (route.plausible === false || !route.origin || !route.destination) continue
        const hex = hexByCallsign.get(callsign)
        if (!hex) continue

        // Re-check the aircraft still exists — it may have dropped off the
        // poll while the lookup was in flight.
        const current = useAircraftStore.getState().aircraftMap.get(hex)
        if (!current) continue

        setRouteData(hex, route.origin, route.destination)
      }
    })
  }, [revision])
}
