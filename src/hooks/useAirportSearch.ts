import { useState, useEffect, useMemo } from 'react'
import Fuse from 'fuse.js'
import type { Airport } from '../types/airport'

let airportList: Airport[] | null = null
let loadPromise: Promise<Airport[]> | null = null

function loadAirports(): Promise<Airport[]> {
  if (airportList) return Promise.resolve(airportList)
  if (loadPromise) return loadPromise
  loadPromise = fetch('/data/airports.json')
    .then((r) => r.json() as Promise<Airport[]>)
    .then((data) => {
      airportList = data
      return data
    })
  return loadPromise
}

/** Synchronous lookup by ICAO code. Returns undefined if the list isn't loaded yet. */
export function getAirportByIcao(icao: string): Airport | undefined {
  return airportList?.find((a) => a.icao === icao.toUpperCase())
}

export function useAirportSearch(query: string) {
  const [airports, setAirports] = useState<Airport[]>([])
  const [results, setResults] = useState<Airport[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    loadAirports()
      .then((data) => {
        setAirports(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const fuse = useMemo(
    () =>
      new Fuse(airports, {
        keys: ['icao', 'iata', 'name', 'city'],
        threshold: 0.3,
      }),
    [airports],
  )

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    const matches = fuse.search(query, { limit: 8 }).map((r: { item: Airport }) => r.item)
    setResults(matches)
  }, [query, fuse])

  return { results, loading }
}
