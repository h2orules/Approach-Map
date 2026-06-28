import { useEffect } from 'react'
import { useAirportStore } from '../store/useAirportStore'
import type { Runway } from '../types/airport'

let runwayDb: Record<string, Runway[]> | null = null
let loadPromise: Promise<Record<string, Runway[]>> | null = null

function loadRunways(): Promise<Record<string, Runway[]>> {
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

export function useRunways() {
  const selectedAirport = useAirportStore((s) => s.selectedAirport)
  const setRunways = useAirportStore((s) => s.setRunways)

  useEffect(() => {
    if (!selectedAirport) {
      setRunways([])
      return
    }
    loadRunways()
      .then((db) => setRunways(db[selectedAirport.icao] ?? []))
      .catch(() => setRunways([]))
  }, [selectedAirport, setRunways])
}
