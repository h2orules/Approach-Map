import { useEffect, useRef } from 'react'
import { useAirportStore, airportKey } from '../store/useAirportStore'
import { ensureAirport, getRunwayInfoForAirport } from '../services/cifpCache'
import { synthesizeRunways } from '../geo/synthesizeRunways'
import type { Airport, Runway } from '../types/airport'

let runwayDb: Record<string, Runway[]> | null = null
let loadPromise: Promise<Record<string, Runway[]>> | null = null

function loadLegacyRunways(): Promise<Record<string, Runway[]>> {
  if (runwayDb) return Promise.resolve(runwayDb)
  if (loadPromise) return loadPromise
  loadPromise = fetch('/data/runways.json')
    .then((r) => r.json() as Promise<Record<string, Runway[]>>)
    .then((data) => {
      runwayDb = data
      return data
    })
  return loadPromise
}

/**
 * Resolve one airport's runways, in order of preference:
 *   1. per-airport data shard  (/data/airports/{key}.json — Phase 1 output)
 *   2. bundled legacy runways.json (86 curated airports)
 *   3. synthesized from CIFP runway thresholds (any airport with procedures)
 * so no airport ever renders runway-less.
 */
async function resolveRunways(airport: Airport): Promise<Runway[]> {
  const key = airportKey(airport)

  // 1. Per-airport shard (may 404 until the Phase-1 shards are committed).
  try {
    const resp = await fetch(`/data/airports/${key}.json`)
    if (resp.ok) {
      const shard = (await resp.json()) as { runways?: Runway[] }
      if (Array.isArray(shard?.runways) && shard.runways.length > 0) return shard.runways
    }
  } catch {
    /* fall through */
  }

  // 2. Legacy bundled runway geometry.
  try {
    const db = await loadLegacyRunways()
    const legacy = db[airport.icao]
    if (legacy && legacy.length > 0) return legacy
  } catch {
    /* fall through */
  }

  // 3. Synthesize from CIFP runway-threshold records.
  await ensureAirport(airport.icao)
  return synthesizeRunways(getRunwayInfoForAirport(airport.icao))
}

export function useRunways() {
  const activeAirports = useAirportStore((s) => s.activeAirports)
  const setRunwaysForAirport = useAirportStore((s) => s.setRunwaysForAirport)

  // Airport keys whose runways have already been resolved (or are in flight),
  // so adding/removing one airport doesn't re-run the shard/legacy/CIFP
  // fallback chain (each tier does a fetch or IDB warm) for every OTHER
  // already-resolved airport on every render of this effect.
  const resolvedKeysRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    const activeKeys = new Set(activeAirports.map(airportKey))

    // Forget airports no longer active, so re-adding one later re-resolves
    // (removeAirport already clears its runwaysByIcao entry).
    for (const key of [...resolvedKeysRef.current]) {
      if (!activeKeys.has(key)) resolvedKeysRef.current.delete(key)
    }

    for (const airport of activeAirports) {
      const key = airportKey(airport)
      if (resolvedKeysRef.current.has(key)) continue
      resolvedKeysRef.current.add(key)
      void resolveRunways(airport)
        .then((runways) => {
          if (cancelled) return
          // Skip if the airport was removed while its runways were loading.
          if (!useAirportStore.getState().activeAirports.some((a) => airportKey(a) === key)) return
          setRunwaysForAirport(key, runways)
        })
        .catch(() => {
          if (cancelled) return
          resolvedKeysRef.current.delete(key)
          setRunwaysForAirport(key, [])
        })
    }
    return () => {
      cancelled = true
    }
  }, [activeAirports, setRunwaysForAirport])
}
