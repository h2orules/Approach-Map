import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'

import { parseCifp } from '../src/workers/cifpParse'
import { currentCycleEffectiveDate, cifpUrl, formatCycleDate } from '../src/utils/airac'
import type { CifpAirportData } from '../src/types/cifp'
import type { Runway } from '../src/types/airport'

import { parseCsv, toRecords } from './lib/csv'
import { downloadCached } from './lib/cache'
import { deriveRunwaysByAirport, type OaRow } from './lib/runways'
import {
  buildLookup,
  resolveOaRow,
  deriveMetadata,
  countProcedures,
  isIcaoKey,
  enumerateAirports,
} from './lib/airportIndex'

/**
 * Compiles the multi-airport search + shard data from the current-cycle FAA
 * CIFP joined to OurAirports metadata:
 *
 *   public/data/airport-index.json  — one compact row per airport WITH approaches
 *   public/data/airports/{key}.json — per-airport metadata + runway geometry
 *
 * Downloads (CIFP zip, OurAirports CSVs) are cached under scripts/.cache/ so
 * re-runs are fast. Run: npm run build-airport-index [-- --force] [--help]
 *
 * This does NOT touch the legacy public/data/airports.json or runways.json —
 * the app keeps reading those until the later multi-airport phases land.
 */

const ROOT = process.cwd()
const PUBLIC_DATA = join(ROOT, 'public', 'data')
const CACHE_DIR = join(ROOT, 'scripts', '.cache')
const INDEX_FILE = join(PUBLIC_DATA, 'airport-index.json')
const SHARD_DIR = join(PUBLIC_DATA, 'airports')

// Real FAA host behind the dev proxy's /api/faa-cifp rewrite (see vite.config.ts).
const FAA_CIFP_PREFIX = '/api/faa-cifp'
const FAA_CIFP_BASE = 'https://aeronav.faa.gov/Upload_313-d/cifp'

// OurAirports CSVs: the github.io site serves straight from the canonical
// davidmegginson/ourairports-data repo, so raw.githubusercontent.com is the
// same data — kept as a mirror for networks that block the github.io host.
const AIRPORTS_CSV = [
  'https://davidmegginson.github.io/ourairports-data/airports.csv',
  'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv',
]
const RUNWAYS_CSV = [
  'https://davidmegginson.github.io/ourairports-data/runways.csv',
  'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/runways.csv',
]

const HELP = `build-airport-index — compile airport-index.json + per-airport shards

Usage: npm run build-airport-index [-- <options>]

Options:
  --force        Ignore scripts/.cache and re-download CIFP + OurAirports CSVs
  --cifp <path>  Use a locally-downloaded CIFP zip instead of fetching from the
                 FAA (for networks where aeronav.faa.gov is unreachable)
  --help, -h     Show this help and exit (no downloads)

Outputs:
  public/data/airport-index.json
  public/data/airports/{key}.json

Downloads are cached in scripts/.cache/ (gitignored).`

/** Decode the FAACIFP18 ARINC 424 text out of the downloaded CIFP zip bytes. */
function extractCifpText(zipBytes: Uint8Array): string {
  const files = unzipSync(zipBytes)
  const entries = Object.entries(files)
  const datEntry =
    entries.find(([name]) => /faacifp/i.test(name)) ??
    entries.find(([name]) => name.toLowerCase().endsWith('.dat')) ??
    entries
      .filter(([name]) => !/\.(pdf|xlsx?|txt|csv)$/i.test(name))
      .sort((a, b) => b[1].length - a[1].length)[0]
  if (!datEntry) throw new Error('No CIFP data file found in zip')
  return new TextDecoder('utf-8').decode(datEntry[1])
}

/** Look up an airport's runways by the matched OA ident / gps_code / local_code, then the raw key. */
function runwaysForAirport(
  byAirport: Record<string, Runway[]>,
  key: string,
  oaRow?: OaRow,
): Runway[] {
  const candidates = [oaRow?.ident, oaRow?.gps_code, oaRow?.local_code, key]
  for (const c of candidates) {
    if (c && byAirport[c]) return byAirport[c]
  }
  return []
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP)
    return
  }
  const force = args.includes('--force')
  const cifpArgIdx = args.indexOf('--cifp')
  const localCifpPath = cifpArgIdx >= 0 ? args[cifpArgIdx + 1] : undefined
  if (cifpArgIdx >= 0 && !localCifpPath) {
    console.error('--cifp requires a path to a CIFP zip')
    process.exit(1)
  }

  mkdirSync(PUBLIC_DATA, { recursive: true })

  // ── CIFP ───────────────────────────────────────────────────────────────────
  const effectiveDate = currentCycleEffectiveDate()
  const dateStr = formatCycleDate(effectiveDate)
  const cifpProxyUrl = cifpUrl(effectiveDate) // /api/faa-cifp/CIFP_YYMMDD.zip
  const cifpUrlAbs = cifpProxyUrl.replace(FAA_CIFP_PREFIX, FAA_CIFP_BASE)
  const cifpFileName = cifpProxyUrl.split('/').pop() ?? 'CIFP.zip'

  let zipBytes: Uint8Array
  if (localCifpPath) {
    console.log(`CIFP from local file — ${localCifpPath}`)
    zipBytes = new Uint8Array(readFileSync(localCifpPath))
  } else {
    console.log(`CIFP cycle ${dateStr} — ${cifpUrlAbs}`)
    zipBytes = await downloadCached(cifpUrlAbs, join(CACHE_DIR, cifpFileName), force)
  }
  const cifpText = extractCifpText(zipBytes)

  console.log('Parsing CIFP…')
  let lastPct = -1
  const cifpData: Record<string, CifpAirportData> = parseCifp(cifpText, (pct) => {
    if (pct >= lastPct + 25 || pct === 100) {
      lastPct = pct
      console.log(`  parse ${pct}%`)
    }
  })
  const parsedCount = Object.keys(cifpData).length

  // ── OurAirports metadata ─────────────────────────────────────────────────────
  const [airportsBytes, runwaysBytes] = await Promise.all([
    downloadCached(AIRPORTS_CSV, join(CACHE_DIR, 'airports.csv'), force),
    downloadCached(RUNWAYS_CSV, join(CACHE_DIR, 'runways.csv'), force),
  ])
  const oaAirports = toRecords(parseCsv(new TextDecoder('utf-8').decode(airportsBytes)))
  const oaRunways = toRecords(parseCsv(new TextDecoder('utf-8').decode(runwaysBytes)))

  const lookup = buildLookup(oaAirports)
  const runwaysByAirport = deriveRunwaysByAirport(oaRunways)

  // ── Index ────────────────────────────────────────────────────────────────────
  const indexRows = enumerateAirports(cifpData, lookup)
  writeFileSync(INDEX_FILE, JSON.stringify(indexRows) + '\n')

  // ── Shards ────────────────────────────────────────────────────────────────────
  // Rebuild the shard directory from scratch so removed airports don't linger.
  if (existsSync(SHARD_DIR)) rmSync(SHARD_DIR, { recursive: true, force: true })
  mkdirSync(SHARD_DIR, { recursive: true })

  let matched = 0
  let centroidFallback = 0
  let unplaced = 0
  let shardsWritten = 0
  let shardsWithRunways = 0

  for (const [key, data] of Object.entries(cifpData)) {
    const counts = countProcedures(data.procedures)
    if (counts.a === 0) continue
    const oaRow = resolveOaRow(lookup, key)
    const meta = deriveMetadata(key, data, oaRow)
    if (!meta) {
      unplaced++
      continue
    }
    if (meta.matched) matched++
    else centroidFallback++

    const runways = runwaysForAirport(runwaysByAirport, key, oaRow)
    if (runways.length > 0) shardsWithRunways++

    const shard = {
      key,
      ...(isIcaoKey(key) ? { icao: key } : {}),
      name: meta.name,
      city: meta.city,
      state: meta.state,
      lat: meta.lat,
      lon: meta.lon,
      elev: meta.elev,
      runways,
    }
    writeFileSync(join(SHARD_DIR, `${key}.json`), JSON.stringify(shard) + '\n')
    shardsWritten++
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log('\nDone.')
  console.log(`  CIFP airports parsed:   ${parsedCount}`)
  console.log(`  Index rows (a>0):       ${indexRows.length}`)
  console.log(`  Matched to OurAirports: ${matched}`)
  console.log(`  CIFP-centroid fallback: ${centroidFallback}`)
  console.log(`  Unplaced (skipped):     ${unplaced}`)
  console.log(`  Shards written:         ${shardsWritten} (${shardsWithRunways} with runways)`)
  console.log(`  → ${INDEX_FILE}`)
  console.log(`  → ${SHARD_DIR}/{key}.json`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
