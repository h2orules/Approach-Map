import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { parseDatisEntries } from '../src/api/datis'
import type { AirportIndexRow } from './lib/airportIndex'
import {
  validateIndexRow,
  validateShard,
  crossCheckCoord,
  type AirportShard,
} from './lib/validate'

/**
 * Validates the compiled static data (public/data/airport-index.json + the
 * per-airport shards) and, with --live, spot-checks the runtime upstream APIs.
 *
 *   npm run validate-static-data            # offline schema + cross-checks
 *   npm run validate-static-data -- --live  # + seeded live-API sampling
 *
 * Posture is advisory: failures below 2% per category exit 0 with warnings and
 * are logged to TODO-data-issues.md (each distinct failure class → its own
 * follow-up diff). Exit 1 only on catastrophic regression (missing files, zero
 * airports, or >2% schema failures in a category).
 */

const ROOT = process.cwd()
const PUBLIC_DATA = join(ROOT, 'public', 'data')
const INDEX_FILE = join(PUBLIC_DATA, 'airport-index.json')
const SHARD_DIR = join(PUBLIC_DATA, 'airports')
const TODO_FILE = join(ROOT, 'TODO-data-issues.md')

const CATASTROPHIC_PCT = 0.02

// Large hubs the --live stratified sample always includes (when present).
const HUBS = ['KATL', 'KLAX', 'KORD', 'KDFW', 'KDEN', 'KJFK', 'KSFO', 'KSEA', 'KLAS', 'KMCO', 'KCLT', 'KPHX']

const DATIS_BASE = 'https://atis.info/api' // mirrors src/api/datis.ts's /api/datis proxy
const AVIATIONAPI_BASE = 'https://api.aviationapi.com/v1'
const ADSBX_BASE = 'https://adsbexchange-com1.p.rapidapi.com/v2'
const ADSBX_HOST = 'adsbexchange-com1.p.rapidapi.com'

// ── seeded RNG ────────────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface CategoryResult {
  name: string
  checked: number
  failures: string[] // "KXXX: reason"
  /** When true a failure rate over the threshold is catastrophic (schema); false = advisory-only. */
  schema: boolean
}

function reportCategory(r: CategoryResult): { catastrophic: boolean; line: string } {
  const invalid = r.failures.length
  const pct = r.checked > 0 ? invalid / r.checked : 0
  const first = r.failures.slice(0, 10).join('; ')
  const line = `${r.name}: ${r.checked} checked, ${invalid} invalid${first ? ` (first ${Math.min(10, invalid)}: ${first})` : ''}`
  const catastrophic = r.schema && pct > CATASTROPHIC_PCT
  return { catastrophic, line }
}

function logTodo(lines: string[]): void {
  if (lines.length === 0) return
  if (!existsSync(TODO_FILE)) {
    appendFileSync(
      TODO_FILE,
      `# Data issues\n\nAppended by scripts/validateStaticData.ts. Each distinct failure class below is\nadvisory and should be fixed in its own follow-up diff (e.g. a CIFP parser edge\ncase at a small field, an OurAirports metadata gap). Re-running the validator\nappends a fresh dated section; prune resolved entries as you fix them.\n`,
    )
  }
  const stamp = new Date().toISOString()
  appendFileSync(TODO_FILE, `\n## ${stamp}\n${lines.map((l) => `- ${l}`).join('\n')}\n`)
}

async function runOffline(): Promise<{ exit: number; todo: string[] }> {
  const todo: string[] = []

  if (!existsSync(INDEX_FILE)) {
    console.error(`FATAL: ${INDEX_FILE} not found — run "npm run build-airport-index" first.`)
    return { exit: 1, todo }
  }
  if (!existsSync(SHARD_DIR)) {
    console.error(`FATAL: ${SHARD_DIR} not found — run "npm run build-airport-index" first.`)
    return { exit: 1, todo }
  }

  const index: AirportIndexRow[] = JSON.parse(readFileSync(INDEX_FILE, 'utf-8'))
  if (!Array.isArray(index) || index.length === 0) {
    console.error('FATAL: airport-index.json is empty or not an array.')
    return { exit: 1, todo }
  }

  // Index-row schema + key uniqueness.
  const indexCat: CategoryResult = { name: 'index rows', checked: index.length, failures: [], schema: true }
  const seen = new Set<string>()
  for (const row of index) {
    const issues = validateIndexRow(row)
    if (seen.has(row.key)) issues.push('key: duplicate')
    seen.add(row.key)
    if (issues.length) indexCat.failures.push(`${row.key || '(no key)'}: ${issues.join(', ')}`)
  }

  // Shard files present on disk.
  const shardFiles = readdirSync(SHARD_DIR).filter((f) => f.endsWith('.json'))
  const shardKeys = new Set(shardFiles.map((f) => f.replace(/\.json$/, '')))

  // Every index row → a shard; every shard → an index row.
  const linkCat: CategoryResult = { name: 'index↔shard', checked: index.length, failures: [], schema: true }
  for (const row of index) {
    if (!shardKeys.has(row.key)) linkCat.failures.push(`${row.key}: missing shard file`)
  }
  const indexKeys = new Set(index.map((r) => r.key))
  let orphans = 0
  for (const k of shardKeys) {
    if (!indexKeys.has(k)) {
      orphans++
      if (linkCat.failures.length < 50) linkCat.failures.push(`${k}: orphan shard (no index row)`)
    }
  }
  linkCat.checked += shardKeys.size

  // Shard schema + coord cross-check (sample of up to 300 for speed).
  const shardCat: CategoryResult = { name: 'shards', checked: 0, failures: [], schema: true }
  const crossCat: CategoryResult = { name: 'coord cross-check', checked: 0, failures: [], schema: false }
  const indexByKey = new Map(index.map((r) => [r.key, r]))
  const rng = mulberry32(1234)
  const sampleForCross = new Set(
    [...shardKeys].filter(() => rng() < Math.min(1, 300 / Math.max(1, shardKeys.size))),
  )
  for (const file of shardFiles) {
    let shard: AirportShard
    try {
      shard = JSON.parse(readFileSync(join(SHARD_DIR, file), 'utf-8'))
    } catch (e) {
      shardCat.checked++
      shardCat.failures.push(`${file}: unparseable JSON (${String(e)})`)
      continue
    }
    shardCat.checked++
    const issues = validateShard(shard)
    if (issues.length) shardCat.failures.push(`${shard.key || file}: ${issues.slice(0, 3).join(', ')}`)

    if (sampleForCross.has(shard.key)) {
      const row = indexByKey.get(shard.key)
      if (row) {
        crossCat.checked++
        const x = crossCheckCoord(row, shard)
        if (x.length) crossCat.failures.push(`${shard.key}: ${x.join(', ')}`)
      }
    }
  }

  console.log('── offline ──')
  let exit = 0
  for (const cat of [indexCat, linkCat, shardCat, crossCat]) {
    const { catastrophic, line } = reportCategory(cat)
    console.log('  ' + line)
    if (catastrophic) exit = 1
    if (cat.failures.length) {
      const rate = cat.checked ? (cat.failures.length / cat.checked) : 0
      todo.push(`[offline] ${cat.name}: ${cat.failures.length}/${cat.checked} (${(rate * 100).toFixed(1)}%) e.g. ${cat.failures[0]}`)
    }
  }
  if (orphans > 0) console.log(`  (orphan shards: ${orphans})`)

  return { exit, todo }
}

async function runLive(seed: number, sampleSize: number): Promise<{ exit: number; todo: string[] }> {
  const todo: string[] = []
  const index: AirportIndexRow[] = JSON.parse(readFileSync(INDEX_FILE, 'utf-8'))
  const byKey = new Map(index.map((r) => [r.key, r]))

  // Stratified seeded sample: up to 5 hubs + the remainder random.
  const hubs = HUBS.filter((h) => byKey.has(h)).slice(0, 5)
  const rest = index.map((r) => r.key).filter((k) => !hubs.includes(k))
  const rng = mulberry32(seed)
  // Fisher-Yates on a copy.
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  const sample = [...hubs, ...rest.slice(0, Math.max(0, sampleSize - hubs.length))]

  console.log(`── live (seed=${seed}, n=${sample.length}: ${hubs.length} hubs + ${sample.length - hubs.length} random) ──`)

  const avia: CategoryResult = { name: 'aviationapi', checked: 0, failures: [], schema: false }
  const datis: CategoryResult = { name: 'datis', checked: 0, failures: [], schema: false }
  let datisPresent = 0
  let datisAbsent = 0
  const adsbx: CategoryResult = { name: 'adsbx', checked: 0, failures: [], schema: false }
  const adsbxKey = process.env.ADSBX_API_KEY

  for (const key of sample) {
    const row = byKey.get(key)
    if (!row) continue
    const icao = row.icao ?? key

    // aviationapi charts — shape is Record<icao, Chart[]>.
    avia.checked++
    try {
      const resp = await fetch(`${AVIATIONAPI_BASE}/charts?apt=${icao}`)
      if (!resp.ok) {
        avia.failures.push(`${key}: HTTP ${resp.status}`)
      } else {
        const data: unknown = await resp.json()
        if (typeof data !== 'object' || data === null) {
          avia.failures.push(`${key}: not an object`)
        } else {
          const charts = (data as Record<string, unknown>)[icao]
          if (charts !== undefined && !Array.isArray(charts)) avia.failures.push(`${key}: charts not an array`)
        }
      }
    } catch (e) {
      avia.failures.push(`${key}: ${String(e)}`)
    }

    // dATIS — array of DatisEntry; 404/empty at small fields is expected (absent).
    datis.checked++
    try {
      const resp = await fetch(`${DATIS_BASE}/${icao}`)
      if (resp.status === 404) {
        datisAbsent++
      } else if (!resp.ok) {
        datis.failures.push(`${key}: HTTP ${resp.status}`)
      } else {
        const data: unknown = await resp.json()
        if (!Array.isArray(data) || data.length === 0) {
          datisAbsent++
        } else {
          const info = parseDatisEntries(data as Parameters<typeof parseDatisEntries>[0])
          if (info === null) datis.failures.push(`${key}: parser returned null on non-empty payload`)
          else datisPresent++
        }
      }
    } catch (e) {
      datis.failures.push(`${key}: ${String(e)}`)
    }

    // ADSBX — only when a key is configured.
    if (adsbxKey) {
      adsbx.checked++
      try {
        const resp = await fetch(`${ADSBX_BASE}/lat/${row.lat.toFixed(4)}/lon/${row.lon.toFixed(4)}/dist/25/`, {
          headers: { 'X-RapidAPI-Key': adsbxKey, 'X-RapidAPI-Host': ADSBX_HOST },
        })
        if (!resp.ok) {
          adsbx.failures.push(`${key}: HTTP ${resp.status}`)
        } else {
          const data: unknown = await resp.json()
          if (typeof data !== 'object' || data === null || !Array.isArray((data as Record<string, unknown>).ac)) {
            adsbx.failures.push(`${key}: missing 'ac' array`)
          }
        }
      } catch (e) {
        adsbx.failures.push(`${key}: ${String(e)}`)
      }
    }
  }

  let exit = 0
  for (const cat of [avia, datis]) {
    const { line } = reportCategory(cat)
    console.log('  ' + line)
    if (cat.failures.length) todo.push(`[live] ${cat.name}: ${cat.failures.length}/${cat.checked} e.g. ${cat.failures[0]}`)
  }
  console.log(`  datis: ${datisPresent} present, ${datisAbsent} absent (ok)`)
  if (adsbxKey) {
    console.log('  ' + reportCategory(adsbx).line)
    if (adsbx.failures.length) todo.push(`[live] adsbx: ${adsbx.failures.length}/${adsbx.checked} e.g. ${adsbx.failures[0]}`)
  } else {
    console.log('  adsbx: skipped (no key)')
  }

  // Live checks are advisory: only a total wipeout (every request failing) is catastrophic.
  if (avia.checked > 0 && avia.failures.length === avia.checked) exit = 1
  return { exit, todo }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log('validate-static-data — offline schema checks; --live for API sampling')
    console.log('Options: --live  --seed=<n>  --sample=<n>')
    return
  }
  const live = args.includes('--live')
  const seedArg = args.find((a) => a.startsWith('--seed='))
  const sampleArg = args.find((a) => a.startsWith('--sample='))
  const seed = seedArg ? parseInt(seedArg.split('=')[1], 10) || 42 : 42
  const sampleSize = sampleArg ? parseInt(sampleArg.split('=')[1], 10) || 15 : 15

  const offline = await runOffline()
  const todo = [...offline.todo]
  let exit = offline.exit

  if (live && exit !== 1) {
    const liveRes = await runLive(seed, sampleSize)
    todo.push(...liveRes.todo)
    if (liveRes.exit === 1) exit = 1
  } else if (live) {
    console.log('── live skipped (offline check was catastrophic) ──')
  }

  logTodo(todo)

  console.log(exit === 0 ? '\nOK (advisory warnings logged to TODO-data-issues.md if any)' : '\nFAILED (catastrophic)')
  process.exit(exit)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
