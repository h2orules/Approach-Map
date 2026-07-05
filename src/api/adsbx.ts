import type { AdsbResponse } from '../types/aircraft'

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
