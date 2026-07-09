import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { fetchCsv } from './lib/csv'
import { deriveRunwaysByAirport } from './lib/runways'
import type { Runway } from '../src/types/airport'

/**
 * Rebuilds public/data/runways.json (and refreshes airport coordinates in
 * airports.json) from the OurAirports open dataset.
 *
 * OurAirports is used instead of FAA NASR because it is a single set of
 * plain CSV files served over HTTPS with no ZIP extraction, no auth, and no
 * 56-day URL juggling — and it carries accurate runway THRESHOLD coordinates
 * plus TRUE headings, which is exactly what the map geometry needs.
 *
 * CSV parsing and runway derivation are shared with buildAirportIndex.ts via
 * scripts/lib/ so both pipelines stay in lock-step.
 *
 * Run: npx tsx scripts/buildStaticData.ts
 */

const PUBLIC_DATA = join(process.cwd(), 'public', 'data')
const AIRPORTS_FILE = join(PUBLIC_DATA, 'airports.json')
const RUNWAYS_FILE = join(PUBLIC_DATA, 'runways.json')

const AIRPORTS_CSV = 'https://davidmegginson.github.io/ourairports-data/airports.csv'
const RUNWAYS_CSV = 'https://davidmegginson.github.io/ourairports-data/runways.csv'

interface Airport {
  icao: string
  iata: string
  name: string
  lat: number
  lon: number
  elevation: number
  city: string
  state: string
}

async function main() {
  await mkdir(PUBLIC_DATA, { recursive: true })

  if (!existsSync(AIRPORTS_FILE)) {
    throw new Error(`${AIRPORTS_FILE} not found — expected the curated airport list to exist.`)
  }
  const airports: Airport[] = JSON.parse(readFileSync(AIRPORTS_FILE, 'utf-8'))
  const wantedIcaos = new Set(airports.map((a) => a.icao))

  const [oaAirports, oaRunways] = await Promise.all([
    fetchCsv(AIRPORTS_CSV),
    fetchCsv(RUNWAYS_CSV),
  ])

  // Refresh airport center coordinates + elevation from OurAirports (keeps the
  // curated icao/iata/name/city/state, fixes any drift in lat/lon/elevation).
  const oaByIcao = new Map<string, Record<string, string>>()
  for (const a of oaAirports) {
    const ident = a.ident || a.gps_code
    if (ident && wantedIcaos.has(ident)) oaByIcao.set(ident, a)
  }

  let refreshed = 0
  for (const apt of airports) {
    const oa = oaByIcao.get(apt.icao)
    if (!oa) continue
    const lat = parseFloat(oa.latitude_deg)
    const lon = parseFloat(oa.longitude_deg)
    const elev = parseFloat(oa.elevation_ft)
    if (!isNaN(lat)) apt.lat = lat
    if (!isNaN(lon)) apt.lon = lon
    if (!isNaN(elev)) apt.elevation = elev
    refreshed++
  }

  // Build runways keyed by ICAO (shared derivation with buildAirportIndex.ts).
  const runwaysByIcao: Record<string, Runway[]> = deriveRunwaysByAirport(oaRunways, wantedIcaos)
  const runwayCount = Object.values(runwaysByIcao).reduce((n, rws) => n + rws.length, 0)

  writeFileSync(AIRPORTS_FILE, JSON.stringify(airports, null, 2) + '\n')
  writeFileSync(RUNWAYS_FILE, JSON.stringify(runwaysByIcao, null, 2) + '\n')

  console.log(`\nDone.`)
  console.log(`  Airports: ${airports.length} (refreshed coords for ${refreshed})`)
  console.log(`  Runways:  ${runwayCount} across ${Object.keys(runwaysByIcao).length} airports`)
  const missing = airports.filter((a) => !runwaysByIcao[a.icao]).map((a) => a.icao)
  if (missing.length) console.log(`  No runway data for: ${missing.join(', ')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
