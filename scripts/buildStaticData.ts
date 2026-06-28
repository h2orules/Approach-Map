import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Rebuilds public/data/runways.json (and refreshes airport coordinates in
 * airports.json) from the OurAirports open dataset.
 *
 * OurAirports is used instead of FAA NASR because it is a single set of
 * plain CSV files served over HTTPS with no ZIP extraction, no auth, and no
 * 56-day URL juggling — and it carries accurate runway THRESHOLD coordinates
 * plus TRUE headings, which is exactly what the map geometry needs.
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

interface RunwayEnd {
  id: string
  heading: number
  lat: number
  lon: number
  displacedThresholdFt: number
}

interface Runway {
  id: string
  lengthFt: number
  widthFt: number
  surfaceCode: string
  lowEnd: RunwayEnd
  highEnd: RunwayEnd
}

/** Minimal RFC-4180 CSV parser (handles quoted fields with embedded commas). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function toRecords(rows: string[][]): Record<string, string>[] {
  const header = rows[0]
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    header.forEach((h, i) => (obj[h] = r[i] ?? ''))
    return obj
  })
}

async function fetchCsv(url: string): Promise<Record<string, string>[]> {
  console.log(`Fetching ${url}`)
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status} ${resp.statusText}`)
  return toRecords(parseCsv(await resp.text()))
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

  // Build runways keyed by ICAO.
  const runwaysByIcao: Record<string, Runway[]> = {}
  let runwayCount = 0

  for (const rw of oaRunways) {
    const icao = rw.airport_ident
    if (!wantedIcaos.has(icao)) continue
    if (rw.closed === '1') continue

    const leLat = parseFloat(rw.le_latitude_deg)
    const leLon = parseFloat(rw.le_longitude_deg)
    const heLat = parseFloat(rw.he_latitude_deg)
    const heLon = parseFloat(rw.he_longitude_deg)
    if (isNaN(leLat) || isNaN(leLon) || isNaN(heLat) || isNaN(heLon)) continue

    const lengthFt = parseInt(rw.length_ft) || 0
    const widthFt = parseInt(rw.width_ft) || 150

    const runway: Runway = {
      id: `${rw.le_ident}/${rw.he_ident}`,
      lengthFt,
      widthFt,
      surfaceCode: (rw.surface || '').toUpperCase().slice(0, 3),
      lowEnd: {
        id: rw.le_ident,
        heading: parseFloat(rw.le_heading_degT) || 0,
        lat: leLat,
        lon: leLon,
        displacedThresholdFt: parseFloat(rw.le_displaced_threshold_ft) || 0,
      },
      highEnd: {
        id: rw.he_ident,
        heading: parseFloat(rw.he_heading_degT) || 0,
        lat: heLat,
        lon: heLon,
        displacedThresholdFt: parseFloat(rw.he_displaced_threshold_ft) || 0,
      },
    }

    if (!runwaysByIcao[icao]) runwaysByIcao[icao] = []
    runwaysByIcao[icao].push(runway)
    runwayCount++
  }

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
