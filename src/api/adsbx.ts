import type { AdsbResponse } from '../types/aircraft'

export async function fetchAircraftByRadius(
  lat: number,
  lon: number,
  radiusNm: number,
): Promise<AdsbResponse> {
  const url = `/api/adsbx/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${Math.round(radiusNm)}/`
  const resp = await fetch(url, {
    headers: {
      'X-RapidAPI-Key': import.meta.env.VITE_ADSBX_API_KEY ?? '',
      'X-RapidAPI-Host': 'adsbexchange-com1.p.rapidapi.com',
    },
  })
  if (!resp.ok) throw new Error(`ADS-B Exchange error: ${resp.status} ${resp.statusText}`)
  return resp.json() as Promise<AdsbResponse>
}
