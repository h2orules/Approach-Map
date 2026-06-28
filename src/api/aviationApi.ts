export type ChartCode = 'DP' | 'STAR' | 'IAP' | 'APD' | 'MIN' | 'HOT' | string

export interface Chart {
  state: string
  state_full: string
  city: string
  volume: string
  airport_name: string
  military: string
  faa_ident: string
  icao_ident: string
  chart_seq: string
  chart_code: ChartCode
  chart_name: string
  pdf_name: string
  pdf_path: string
}

export type ChartsResponse = Record<string, Chart[]>

export async function fetchCharts(icao: string): Promise<Chart[]> {
  const resp = await fetch(`/api/aviationapi/charts?apt=${icao.toUpperCase()}`)
  if (!resp.ok) throw new Error(`aviationapi.com error: ${resp.status}`)
  const data = (await resp.json()) as ChartsResponse
  return data[icao.toUpperCase()] ?? []
}
