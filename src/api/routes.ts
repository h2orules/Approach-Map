/**
 * Route enrichment (origin/destination lookup) — pluggable provider chain.
 *
 * adsb.lol's keyless `/routeset` endpoint is queried first (batched, one POST
 * per poll for every candidate aircraft); it also returns a server-side
 * `plausible` flag computed from real airport data, so callers no longer need
 * to sanity-check results against a bundled airport list themselves. Any
 * callsign it confirms as unknown falls back to a per-callsign adsbdb lookup
 * (static VRS standing data). Transient failures (network errors, non-2xx,
 * malformed responses) are never cached as negatives — they're retried with
 * exponential backoff — while confirmed-unknown callsigns are negative-cached
 * for a while and positive results are cached for the session.
 */

import {
  ROUTE_NEGATIVE_TTL_MS,
  ROUTE_RETRY_BASE_MS,
  ROUTE_RETRY_MAX_MS,
} from '../config/constants'

export interface RouteQuery {
  callsign: string
  lat: number
  lon: number
}

export interface RouteResult {
  callsign: string
  origin: string | null
  destination: string | null
  plausible: boolean | null
  /** Reserved for a future AeroAPI provider that returns the true filed route. */
  filedRoute?: string | null
  source: 'adsblol' | 'adsbdb' | 'aeroapi'
}

export interface RouteProvider {
  name: string
  /**
   * Keyed by normalized (trimmed, uppercased) callsign.
   * RouteResult in the map = found. `null` = confirmed-unknown (cacheable).
   * A key absent from the returned map = transient failure (retry later).
   */
  lookupBatch(queries: RouteQuery[]): Promise<Map<string, RouteResult | null>>
}

interface RoutesetAirport {
  icao?: unknown
}

interface RoutesetItem {
  callsign?: unknown
  airport_codes?: unknown
  _airports?: unknown
  plausible?: unknown
}

/** Pure parser for the adsb.lol `/routeset` response — exported for tests. */
export function parseRoutesetResponse(json: unknown): Map<string, RouteResult | null> {
  const map = new Map<string, RouteResult | null>()
  if (!Array.isArray(json)) return map

  for (const raw of json as RoutesetItem[]) {
    if (!raw || typeof raw !== 'object') continue
    const callsignRaw = raw.callsign
    if (typeof callsignRaw !== 'string' || !callsignRaw.trim()) continue
    const callsign = callsignRaw.trim().toUpperCase()

    if (raw.airport_codes === 'unknown') {
      map.set(callsign, null)
      continue
    }

    const airports = raw._airports
    if (!Array.isArray(airports) || airports.length === 0) {
      map.set(callsign, null)
      continue
    }

    const first = airports[0] as RoutesetAirport | undefined
    const last = airports[airports.length - 1] as RoutesetAirport | undefined
    const origin = first?.icao
    const destination = last?.icao

    if (typeof origin !== 'string' || !origin || typeof destination !== 'string' || !destination) {
      map.set(callsign, null)
      continue
    }

    map.set(callsign, {
      callsign,
      origin,
      destination,
      plausible: Boolean(raw.plausible),
      source: 'adsblol',
    })
  }

  return map
}

const adsbLolProvider: RouteProvider = {
  name: 'adsblol',
  async lookupBatch(queries) {
    if (queries.length === 0) return new Map()

    // An empty Map returned here means "transient failure" to the caller, which
    // backs the callsigns off WITHOUT cascading to adsbdb. Reserve that only for
    // real transport failures (network error / non-2xx). A 2xx that carries no
    // usable route data is a different case handled below.
    let resp: Response
    try {
      resp = await fetch('/api/adsblol/routeset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planes: queries.map((q) => ({ callsign: q.callsign, lat: q.lat, lng: q.lon })),
        }),
      })
    } catch {
      return new Map() // network error -- transient, back off (no cascade)
    }
    if (!resp.ok) return new Map() // non-2xx -- transient, back off (no cascade)

    let json: unknown = null
    try {
      json = await resp.json()
    } catch {
      // 2xx with an empty/unparseable body -- observed when adsb.lol's routeset
      // edge returns bare 201s. Not transient; fall through to cascade.
    }
    const parsed = parseRoutesetResponse(json)
    if (parsed.size > 0) return parsed

    // adsb.lol answered but gave us nothing usable for the entire batch. Mark
    // every callsign unknown-here (not a transient miss) so they cascade to the
    // adsbdb fallback instead of the outage silently suppressing all enrichment.
    return new Map(queries.map((q) => [q.callsign.trim().toUpperCase(), null]))
  },
}

interface AdsbdbFlightRoute {
  origin?: { icao_code?: string }
  destination?: { icao_code?: string }
}

interface AdsbdbResponse {
  response?: {
    flightroute?: AdsbdbFlightRoute | null
  }
}

const adsbdbProvider: RouteProvider = {
  name: 'adsbdb',
  async lookupBatch(queries) {
    const map = new Map<string, RouteResult | null>()
    // adsbdb has no batch endpoint; a handful of misses per poll is fine
    // queried sequentially.
    for (const q of queries) {
      const cs = q.callsign.trim().toUpperCase()
      try {
        const resp = await fetch(`/api/adsbdb/callsign/${encodeURIComponent(cs)}`)
        if (resp.status === 404) {
          map.set(cs, null)
          continue
        }
        if (!resp.ok) continue // transient — leave key absent

        const data = (await resp.json()) as AdsbdbResponse
        const route = data?.response?.flightroute
        const origin = route?.origin?.icao_code
        const destination = route?.destination?.icao_code
        if (origin && destination) {
          map.set(cs, { callsign: cs, origin, destination, plausible: null, source: 'adsbdb' })
        } else {
          map.set(cs, null)
        }
      } catch {
        // network error — transient, leave key absent
      }
    }
    return map
  },
}

// Future seam: FlightAware AeroAPI would return the true filed flight plan
// (surfaced via RouteResult.filedRoute) and should be consulted first when a
// key is configured:
//   if (import.meta.env.VITE_AEROAPI_KEY) providers.unshift(aeroApiProvider)
// Not implemented — no AeroAPI provider exists yet.
function getProviders(): RouteProvider[] {
  return [adsbLolProvider, adsbdbProvider]
}

interface CacheEntry {
  result: RouteResult | null
  /** null = session-permanent (positive results only). */
  expiresAt: number | null
}

interface RetryEntry {
  failures: number
  nextAttemptMs: number
}

const cache = new Map<string, CacheEntry>()
const retryAt = new Map<string, RetryEntry>()
const pending = new Set<string>()

function normalize(callsign: string): string {
  return callsign.trim().toUpperCase()
}

function applyBackoff(callsign: string, now: number): void {
  const prev = retryAt.get(callsign)
  const failures = (prev?.failures ?? 0) + 1
  const delay = Math.min(ROUTE_RETRY_BASE_MS * 2 ** (failures - 1), ROUTE_RETRY_MAX_MS)
  retryAt.set(callsign, { failures, nextAttemptMs: now + delay })
}

export function clearRouteCache(): void {
  cache.clear()
  retryAt.clear()
  pending.clear()
}

export async function lookupRoutes(queries: RouteQuery[]): Promise<Map<string, RouteResult>> {
  const now = Date.now()
  const result = new Map<string, RouteResult>()
  const remaining: RouteQuery[] = []

  for (const q of queries) {
    const cs = normalize(q.callsign)
    const cached = cache.get(cs)
    if (cached && (cached.expiresAt === null || cached.expiresAt > now)) {
      if (cached.result) result.set(cs, cached.result)
      continue
    }
    if (pending.has(cs)) continue
    const backoff = retryAt.get(cs)
    if (backoff && backoff.nextAttemptMs > now) continue
    remaining.push({ ...q, callsign: cs })
  }

  if (remaining.length === 0) return result

  for (const q of remaining) pending.add(q.callsign)

  try {
    let unknownQueue = remaining
    for (const provider of getProviders()) {
      if (unknownQueue.length === 0) break

      let batch: Map<string, RouteResult | null>
      try {
        batch = await provider.lookupBatch(unknownQueue)
      } catch {
        batch = new Map()
      }

      const stillUnknown: RouteQuery[] = []
      for (const q of unknownQueue) {
        const cs = q.callsign
        if (!batch.has(cs)) {
          // Transient failure at this provider — back off, don't cascade to
          // the next provider (that would hammer the fallback on every
          // outage of the primary).
          applyBackoff(cs, now)
          continue
        }
        const r = batch.get(cs) ?? null
        if (r === null) {
          stillUnknown.push(q) // confirmed-unknown here — let the next provider try
          continue
        }
        if (r.plausible === false) {
          cache.set(cs, { result: null, expiresAt: now + ROUTE_NEGATIVE_TTL_MS })
        } else {
          cache.set(cs, { result: r, expiresAt: null })
          result.set(cs, r)
        }
        retryAt.delete(cs)
      }
      unknownQueue = stillUnknown
    }

    // Confirmed unknown by every provider in the chain.
    for (const q of unknownQueue) {
      cache.set(q.callsign, { result: null, expiresAt: now + ROUTE_NEGATIVE_TTL_MS })
      retryAt.delete(q.callsign)
    }
  } finally {
    for (const q of remaining) pending.delete(q.callsign)
  }

  return result
}
