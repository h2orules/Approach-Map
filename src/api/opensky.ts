/**
 * OpenSky Network route lookup — maps a callsign to [origin, destination] ICAO.
 * Free, no API key. Results are cached for the session so each callsign is
 * queried at most once.
 */

interface OpenSkyRoute {
  callsign: string
  route: string[]
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
    const resp = await fetch(`/api/opensky/routes?callsign=${encodeURIComponent(cs)}`)
    if (!resp.ok) {
      cache.set(cs, null)
      return null
    }
    const data = (await resp.json()) as OpenSkyRoute
    const route = data.route
    const result: [string, string] | null =
      Array.isArray(route) && route.length >= 2
        ? [route[0], route[route.length - 1]]
        : null
    cache.set(cs, result)
    return result
  } catch {
    cache.set(cs, null)
    return null
  } finally {
    pending.delete(cs)
  }
}
