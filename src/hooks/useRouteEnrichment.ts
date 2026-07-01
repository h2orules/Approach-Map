import { useEffect } from 'react'
import * as turf from '@turf/turf'
import { useAircraftStore } from '../store/useAircraftStore'
import { getAirportByIcao } from './useAirportSearch'
import { fetchRoute } from '../api/opensky'

// Only standard airline callsigns (3 uppercase letters + digit) have scheduled
// route data in adsbdb. Callsigns with letter suffixes (e.g. UAL360T) or
// all-numeric suffixes are typically training/charter/special flights whose
// flight number may not match any scheduled route — still worth querying but
// we validate the result against position before storing.
const AIRLINE_CS = /^[A-Z]{3}\d/

// Maximum acceptable cross-track distance from the origin→destination straight
// line.  An aircraft more than 400 nm off that line is almost certainly not
// on that route (stale adsbdb data, callsign reuse, training suffix, etc.).
const MAX_ROUTE_DEVIATION_NM = 400

/**
 * After each ADS-B poll, queries adsbdb.com for origin/destination of airline
 * aircraft that don't already have route data.  Results are validated against
 * the aircraft's current position and cached per callsign for the session.
 */
export function useRouteEnrichment() {
  const revision = useAircraftStore((s) => s.revision)

  useEffect(() => {
    const { getAll, setRouteData } = useAircraftStore.getState()
    const candidates = getAll().filter(
      (ac) => !ac.origin && !ac.destination && AIRLINE_CS.test(ac.flight),
    )

    for (const ac of candidates) {
      const { hex, flight } = ac
      fetchRoute(flight).then((result) => {
        if (!result) return
        const [origin, destination] = result

        // Re-fetch the current position — the aircraft may have moved since we
        // queued the lookup.
        const current = useAircraftStore.getState().aircraftMap.get(hex)
        if (!current) return

        // Validate: if we know both airport locations, reject results where the
        // aircraft is clearly not on that route (stale/wrong callsign mapping).
        const originApt = getAirportByIcao(origin)
        const destApt = getAirportByIcao(destination)
        if (originApt && destApt) {
          const routeLine = turf.lineString([
            [originApt.lon, originApt.lat],
            [destApt.lon, destApt.lat],
          ])
          const acPt = turf.point([current.interpLon, current.interpLat])
          const nearest = turf.nearestPointOnLine(routeLine, acPt, { units: 'nauticalmiles' })
          if ((nearest.properties.dist ?? Infinity) > MAX_ROUTE_DEVIATION_NM) return
        }

        setRouteData(hex, origin, destination)
      })
    }
  }, [revision])
}
