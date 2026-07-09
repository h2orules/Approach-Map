import { useState, useEffect, useMemo } from 'react'
import Fuse from 'fuse.js'
import type { Airport } from '../types/airport'

/** One row of public/data/airport-index.json — mirrors scripts/lib/airportIndex.ts's AirportIndexRow. */
interface AirportIndexRow {
  key: string
  icao?: string
  name: string
  city: string
  state: string
  lat: number
  lon: number
  elev: number
  s: number
  t: number
  a: number
}

/** Per-airport SID/STAR/approach counts, keyed by `key` (falls back to `icao` for legacy rows). */
export interface AirportCounts {
  s: number
  t: number
  a: number
}

interface AirportSearchData {
  airports: Airport[]
  counts: Map<string, AirportCounts>
}

/**
 * Maps raw `airport-index.json` rows to the `Airport` type used throughout the
 * app, plus a parallel counts map for display. Pure and independently testable.
 *
 * LID-only airports (no `icao` field in the row) get `icao` set to `key` for
 * display purposes — `.icao` is read pervasively downstream (search, procedure
 * lookups, runway/ATIS fetches) and CIFP data is keyed by the same identifier
 * (equals ICAO for ICAO airports, the FAA LID otherwise), so this is also
 * functionally correct, not just cosmetic.
 *
 * Throws if `json` isn't an array (e.g. an HTML error page or an unexpected
 * shape) so the caller can fall back to the legacy airport list.
 */
export function parseIndexRows(json: unknown): AirportSearchData {
  if (!Array.isArray(json)) {
    throw new Error('airport-index.json: expected an array of rows')
  }
  const airports: Airport[] = []
  const counts = new Map<string, AirportCounts>()
  for (const row of json) {
    if (!row || typeof row !== 'object') continue
    const r = row as Partial<AirportIndexRow>
    if (
      typeof r.key !== 'string' ||
      typeof r.name !== 'string' ||
      typeof r.lat !== 'number' ||
      typeof r.lon !== 'number'
    ) {
      continue
    }
    airports.push({
      key: r.key,
      icao: r.icao ?? r.key,
      iata: '',
      name: r.name,
      city: r.city ?? '',
      state: r.state ?? '',
      lat: r.lat,
      lon: r.lon,
      elevation: r.elev ?? 0,
    })
    counts.set(r.key, { s: r.s ?? 0, t: r.t ?? 0, a: r.a ?? 0 })
  }
  return { airports, counts }
}

async function fetchIndex(): Promise<AirportSearchData> {
  const res = await fetch('/data/airport-index.json')
  if (!res.ok) throw new Error(`airport-index.json: HTTP ${res.status}`)
  const json = await res.json()
  return parseIndexRows(json)
}

async function fetchLegacyAirports(): Promise<AirportSearchData> {
  const res = await fetch('/data/airports.json')
  const airports = (await res.json()) as Airport[]
  return { airports, counts: new Map() }
}

let cached: AirportSearchData | null = null
let loadPromise: Promise<AirportSearchData> | null = null

function loadAirports(): Promise<AirportSearchData> {
  if (cached) return Promise.resolve(cached)
  if (loadPromise) return loadPromise
  loadPromise = fetchIndex()
    .catch((err) => {
      console.warn(
        'airport-index.json unavailable or malformed, falling back to legacy airports.json:',
        err,
      )
      return fetchLegacyAirports()
    })
    .then((data) => {
      cached = data
      return data
    })
  return loadPromise
}

/** Synchronous lookup by ICAO code (or FAA LID). Returns undefined if the list isn't loaded yet. */
export function getAirportByIcao(icao: string): Airport | undefined {
  return cached?.airports.find((a) => a.icao.toUpperCase() === icao.toUpperCase())
}

export function useAirportSearch(query: string) {
  const [airports, setAirports] = useState<Airport[]>([])
  const [counts, setCounts] = useState<Map<string, AirportCounts>>(new Map())
  const [results, setResults] = useState<Airport[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    loadAirports()
      .then((data) => {
        setAirports(data.airports)
        setCounts(data.counts)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const fuse = useMemo(
    () =>
      new Fuse(airports, {
        keys: ['icao', 'key', 'name', 'city'],
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

  return { results, loading, counts }
}
