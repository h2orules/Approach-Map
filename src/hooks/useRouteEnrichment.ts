import { useEffect } from 'react'
import { useAircraftStore } from '../store/useAircraftStore'
import { fetchRoute } from '../api/opensky'

// Only airline callsigns (3 letters + digits) have route data in OpenSky.
const AIRLINE_CS = /^[A-Z]{3}\d/

/**
 * After each ADS-B poll, queries OpenSky Network for origin/destination of
 * airline aircraft that don't already have route data. Results are cached in
 * the opensky module so each callsign is fetched at most once per session.
 */
export function useRouteEnrichment() {
  const revision = useAircraftStore((s) => s.revision)

  useEffect(() => {
    const { getAll, setRouteData } = useAircraftStore.getState()
    const candidates = getAll().filter(
      (ac) => !ac.origin && !ac.destination && AIRLINE_CS.test(ac.flight),
    )

    for (const ac of candidates) {
      fetchRoute(ac.flight).then((result) => {
        if (result) setRouteData(ac.hex, result[0], result[1])
      })
    }
  }, [revision])
}
