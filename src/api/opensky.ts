/**
 * adsbdb.com callsign route lookup — maps an ICAO callsign to [origin, destination].
 * Free public API, no key required. Results are cached for the session so each
 * callsign is queried at most once.
 */

interface AdsbdbResponse {
  response: {
    flightroute?: {
      origin?: { icao_code?: string }
      destination?: { icao_code?: string }
    } | null
  }
}

// Resolved results (null = confirmed no route data for this callsign)
const cache = new Map<string, [string, string] | null>()
// Callsigns currently in-flight to avoid duplicate concurrent requests
const pending = new Set<string>()

export async function fetchRoute(callsign: string): Promise<[string, string] | null> {
  const cs = callsign.trim().toUpperCase()
  if (cache.has(cs)) return cache.get(cs) ?? null
  if (pending.has(cs)) return null

  pending.add(cs)
  try {
    const resp = await fetch(`/api/adsbdb/callsign/${encodeURIComponent(cs)}`)
    if (!resp.ok) {
      cache.set(cs, null)
      return null
    }
    const data = (await resp.json()) as AdsbdbResponse
    const route = data?.response?.flightroute
    const origin = route?.origin?.icao_code
    const destination = route?.destination?.icao_code
    const result: [string, string] | null =
      origin && destination ? [origin, destination] : null
    cache.set(cs, result)
    return result
  } catch {
    cache.set(cs, null)
    return null
  } finally {
    pending.delete(cs)
  }
}
