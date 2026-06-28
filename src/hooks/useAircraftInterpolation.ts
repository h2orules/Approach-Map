import { useEffect, useRef } from 'react'
import { useAircraftStore } from '../store/useAircraftStore'
import { deadReckon } from '../geo/interpolation'

export function useAircraftInterpolation() {
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    function tick() {
      const now = Date.now()
      const { aircraftMap, updateInterpolated } = useAircraftStore.getState()

      for (const ac of aircraftMap.values()) {
        if (ac.altBaro === 'ground' || ac.groundspeed <= 0) continue
        const elapsed = now - ac.lastPollMs
        if (elapsed <= 0 || elapsed > 120_000) continue

        const { lat, lon } = deadReckon(ac.lat, ac.lon, ac.track, ac.groundspeed, elapsed)
        if (!isNaN(lat) && !isNaN(lon)) {
          updateInterpolated(ac.hex, lat, lon)
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])
}
