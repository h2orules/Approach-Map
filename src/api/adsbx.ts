import type { AdsbAircraft, AdsbResponse } from '../types/aircraft'

// The ADS-B Exchange RapidAPI key is attached server-side (never in the
// client bundle): by the Vite dev proxy in dev (vite.config.ts, from
// ADSBX_API_KEY in .env.local) and by the Azure Functions proxy in
// production (api/src/functions/proxy.ts, from app settings).
export async function fetchAircraftByRadius(
  lat: number,
  lon: number,
  radiusNm: number,
): Promise<AdsbResponse> {
  const url = `/api/adsbx/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${Math.round(radiusNm)}/`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`ADS-B Exchange error: ${resp.status} ${resp.statusText}`)
  return resp.json() as Promise<AdsbResponse>
}

/**
 * Merge the aircraft arrays from several cluster poll responses into one deduped
 * list. Overlapping cluster circles can return the same hex from more than one
 * query; the freshest copy wins — smaller `seen` (seconds since any message),
 * tie-broken by smaller `seen_pos` (seconds since a positional message). A
 * missing `seen`/`seen_pos` is treated as +∞ (staler than any real value).
 * Null/undefined responses (a failed or not-yet-loaded cluster query) are
 * skipped. The result feeds `updateFromPoll`, which already filters on
 * `seen_pos` and prunes stale hexes.
 */
export function mergeAircraftResponses(
  responses: Array<AdsbResponse | null | undefined>,
): AdsbAircraft[] {
  const byHex = new Map<string, AdsbAircraft>()
  const freshness = (ac: AdsbAircraft): [number, number] => [
    ac.seen ?? Infinity,
    ac.seen_pos ?? Infinity,
  ]
  for (const resp of responses) {
    if (!resp?.ac) continue
    for (const ac of resp.ac) {
      const existing = byHex.get(ac.hex)
      if (!existing) {
        byHex.set(ac.hex, ac)
        continue
      }
      const [s, sp] = freshness(ac)
      const [es, esp] = freshness(existing)
      if (s < es || (s === es && sp < esp)) byHex.set(ac.hex, ac)
    }
  }
  return [...byHex.values()]
}
