import { create } from 'zustand'
import { unzipSync } from 'fflate'
import type { Procedure } from '../types/procedure'
import type { CifpAirportData, CifpRunwayInfo } from '../types/cifp'
import type { SafeAltitudeArea } from '../types/safeAltitude'
import { currentCycleEffectiveDate, nextCycleDate, cifpUrl, formatCycleDate, isCycleStale } from '../utils/airac'
import { createIndexedDbStore, type KVStore } from './db'

// Bump whenever the ARINC 424 parser logic changes, so previously cached
// parse results (which may have been produced by buggy parser code) are
// discarded and the CIFP is re-parsed even within the same AIRAC cycle.
// v11: parser now emits CifpAirportData (procedures + safe altitudes + runway
// info + magvar) instead of a bare Procedure[] per airport.
// v12: approach runways are also derived from the procedure ident (I16R →
// 16R), fixing empty runways[] on approaches (TDZE/length + ILS GS lookups).
// v13: terminal NDBs (P/N) parsed; approach FAFs collocated with an NDB are
// tagged as outer markers (LOM) via WaypointSymbol.marker/markerLocator.
// v14: collocated NDB symbols are snapped onto the LOM FAF so they render at
// the same point (they're cataloged ~100 ft apart).
// v15: new 'if' waypoint role (desc-code B/I; C/D now map to 'iaf'); NoPT
// transitions inferred and tagged (ProcedureTransition.noPt); PI legs decoded
// per ARINC 424 semantics (coded course = barb, legLen = remain-within limit →
// ProcedureLeg.pi with real outbound/inbound courses); hold/PT shapes drawn
// with true courses (magnetic + airport magvar); leg vertical descent angle
// parsed (ProcedureLeg.vertAngleDeg) with VDA fallback for gpaDeg
// (Procedure.gsSource); Procedure.magVarDeg and Procedure.courseReversal added.
// v16: procedure-turn barb anchored on the final path when its fix is collocated
// with the FAF (outbound leg no longer drifts off the final course); barb now
// includes a half-arrowhead at its outer tip.
// v17: shortened the procedure-turn barb half-arrowhead for cleaner proportions.
// v18: skip ARINC continuation records (col 39 > '1') — the SBAS FAS 'W'
// continuation on RNAV FAF legs was overwriting the primary leg, erasing the
// FAF role and its altitude constraint (e.g. KAWO R34 YAYKU 1700').
// v19: LOM detection no longer applies to RNAV/RNP approaches (their plates
// don't chart marker beacons — KAWO R34 YAYKU beside the AW NDB is not a LOM).
// v20: single-leg transitions kept (a HILPT is its own one-leg HF transition —
// KAWO R34 "SAVOY"), so the racetrack renders and NoPT inference sees it;
// Procedure.holdInLieu derived from the HF leg; hold features carry the leg's
// alt constraint; missed-approach holds duplicating a transition hold dropped.
// v21: IndexedDB layout changed from one monolithic 'data' blob to one record
// per airport ('airport:'+key → CifpAirportData) plus meta keys
// 'effectiveDate' / 'parserVersion' / 'airportKeys' (string[] of every parsed
// key). useCifpStore.data now holds only lazily-warmed airports (via
// ensureAirport(key)) instead of the whole country, so a cold start from IDB
// doesn't load every airport's geometry into memory up front.
const PARSER_VERSION = 21

export type CifpStatus = 'idle' | 'fetching' | 'parsing' | 'ready' | 'error'

interface CifpStore {
  status: CifpStatus
  progress: number
  progressMessage: string
  effectiveDate: string | null
  /** Only airports that have been warmed this session (see `ensureAirport`). */
  data: Record<string, CifpAirportData>
  /** Every airport key available in the current CIFP parse, warmed or not. */
  airportKeys: string[]
  error: string | null

  setStatus: (s: CifpStatus, progress?: number, message?: string) => void
  setReady: (data: Record<string, CifpAirportData>, airportKeys: string[], effectiveDate: string) => void
  putAirport: (key: string, airportData: CifpAirportData) => void
  setError: (e: string) => void
}

export const useCifpStore = create<CifpStore>((set) => ({
  status: 'idle',
  progress: 0,
  progressMessage: '',
  effectiveDate: null,
  data: {},
  airportKeys: [],
  error: null,

  setStatus: (status, progress = 0, progressMessage = '') =>
    set({ status, progress, progressMessage }),
  setReady: (data, airportKeys, effectiveDate) =>
    set({ data, airportKeys, effectiveDate, status: 'ready', error: null }),
  putAirport: (key, airportData) =>
    set((s) => ({ data: { ...s.data, [key]: airportData } })),
  setError: (error) => set({ error, status: 'error' }),
}))

// Injectable KV seam — real IndexedDB in the app, an in-memory fake in tests.
let kv: KVStore = createIndexedDbStore()

/** Test-only seam: point cifpCache at a fake KVStore (see `./db.ts`). */
export function __setKvStoreForTests(store: KVStore): void {
  kv = store
}

let inflightPromise: Promise<void> | null = null
let rolloverTimer: ReturnType<typeof setTimeout> | null = null

// setTimeout stores its delay as a signed 32-bit int: anything above 2^31-1 ms
// (~24.8 days) fires immediately instead. Early in a 28-day AIRAC cycle the
// time to the next boundary exceeds that, so a naive setTimeout(next - now)
// fires at once → refetch → reschedule → endless download/parse loop.
const MAX_TIMEOUT_DELAY_MS = 0x7fffffff

function scheduleRollover(): void {
  if (rolloverTimer) clearTimeout(rolloverTimer)
  const msUntilNext = nextCycleDate().getTime() - Date.now()

  if (msUntilNext > MAX_TIMEOUT_DELAY_MS) {
    // Too far out for one setTimeout — sleep the max and re-measure.
    rolloverTimer = setTimeout(scheduleRollover, MAX_TIMEOUT_DELAY_MS)
    return
  }

  rolloverTimer = setTimeout(() => {
    // Belt and braces: only refetch if the cached cycle really is stale. A
    // timer that fires early (clock skew, timer clamping) just re-arms.
    if (!isCycleStale(useCifpStore.getState().effectiveDate)) {
      scheduleRollover()
      return
    }
    void fetchAndParseCifp()
  }, Math.max(0, msUntilNext))
}

/** Persists a freshly parsed national CIFP as one IDB record per airport
 *  (batched, see `KVStore.putMany`) plus the meta keys, then drops the
 *  legacy monolithic 'data' blob if one is still lingering from before v21. */
async function persistParsedData(data: Record<string, CifpAirportData>, dateStr: string): Promise<void> {
  const airportKeys = Object.keys(data)
  const entries: Array<[string, unknown]> = airportKeys.map((key) => [`airport:${key}`, data[key]])
  await kv.putMany(entries)
  await kv.putMany([
    ['effectiveDate', dateStr],
    ['parserVersion', PARSER_VERSION],
    ['airportKeys', airportKeys],
  ])
  await kv.delete('data')
}

async function fetchAndParseCifp(): Promise<void> {
  const store = useCifpStore.getState()
  const effectiveDate = currentCycleEffectiveDate()
  const dateStr = formatCycleDate(effectiveDate)

  store.setStatus('fetching', 0, 'Downloading updated procedures (28-day cycle)…')

  let text: string
  try {
    const resp = await fetch(cifpUrl(effectiveDate))
    if (!resp.ok) throw new Error(`HTTP ${resp.status} downloading CIFP`)

    const zipBytes = new Uint8Array(await resp.arrayBuffer())
    const files = unzipSync(zipBytes)

    // The ARINC 424 data file is named "FAACIFP18" (no extension). Older/other
    // packagings may use ".dat". Match by name, then fall back to the largest
    // non-document entry.
    const entries = Object.entries(files)
    const datEntry =
      entries.find(([name]) => /faacifp/i.test(name)) ??
      entries.find(([name]) => name.toLowerCase().endsWith('.dat')) ??
      entries
        .filter(([name]) => !/\.(pdf|xlsx?|txt|csv)$/i.test(name))
        .sort((a, b) => b[1].length - a[1].length)[0]

    if (!datEntry) throw new Error('No CIFP data file found in zip')

    text = new TextDecoder('utf-8').decode(datEntry[1])
  } catch (err) {
    store.setError(`Failed to download CIFP: ${String(err)}`)
    return
  }

  store.setStatus('parsing', 10, 'Parsing procedure data…')

  const worker = new Worker(new URL('../workers/cifpParser.worker.ts', import.meta.url), {
    type: 'module',
  })

  await new Promise<void>((resolve, reject) => {
    worker.onmessage = (e) => {
      const msg = e.data as { type: string; percent?: number; message?: string; data?: Record<string, CifpAirportData>; message2?: string }
      if (msg.type === 'progress') {
        store.setStatus('parsing', msg.percent ?? 0, msg.message ?? '')
      } else if (msg.type === 'result') {
        const data = msg.data as Record<string, CifpAirportData>
        // The fresh parse is kept fully in memory for this session (simplest
        // model — it's already all in memory right here); only a *cold start*
        // reading back from IDB avoids eagerly warming every airport.
        store.setReady(data, Object.keys(data), dateStr)
        persistParsedData(data, dateStr).catch(console.error)
        resolve()
      } else if (msg.type === 'error') {
        reject(new Error(msg.message as string))
      }
    }
    worker.onerror = (e) => reject(e)
    worker.postMessage({ type: 'parse', text })
  }).catch((err) => {
    store.setError(String(err))
  }).finally(() => {
    worker.terminate()
  })

  scheduleRollover()
}

async function checkAndRefreshIfStale(): Promise<void> {
  const storedDate = await kv.get<string>('effectiveDate')
  const storedVersion = await kv.get<number>('parserVersion')
  const storedAirportKeys = await kv.get<string[]>('airportKeys')

  if (
    storedVersion === PARSER_VERSION &&
    !isCycleStale(storedDate ?? null) &&
    storedAirportKeys &&
    storedAirportKeys.length > 0
  ) {
    // Cache hit: the index of available airports is valid, but nothing is
    // warmed into memory yet — callers warm individual airports on demand via
    // `ensureAirport`. This is what keeps cold-start memory bounded.
    useCifpStore.getState().setReady({}, storedAirportKeys, storedDate!)
    scheduleRollover()
    return
  }

  inflightPromise = fetchAndParseCifp()
  await inflightPromise
  inflightPromise = null
}

export async function getCifpData(): Promise<void> {
  if (inflightPromise) return inflightPromise
  return checkAndRefreshIfStale()
}

/**
 * Warms one airport's parsed CIFP data into memory if it isn't already there.
 * No-op (resolves true immediately) once warmed. Returns false if the key
 * isn't in the current CIFP parse at all (no published procedures / unknown
 * key) — callers should treat that the same as "no procedures found".
 */
export async function ensureAirport(key: string): Promise<boolean> {
  const k = key.toUpperCase()
  if (useCifpStore.getState().data[k]) return true

  const record = await kv.get<CifpAirportData>(`airport:${k}`)
  if (!record) return false

  useCifpStore.getState().putAirport(k, record)
  return true
}

export function getProceduresForAirport(icao: string): Procedure[] {
  return useCifpStore.getState().data[icao.toUpperCase()]?.procedures ?? []
}

export function getSafeAltitudesForAirport(icao: string): SafeAltitudeArea[] {
  return useCifpStore.getState().data[icao.toUpperCase()]?.safeAltitudes ?? []
}

export function getRunwayInfoForAirport(icao: string): Record<string, CifpRunwayInfo> {
  return useCifpStore.getState().data[icao.toUpperCase()]?.runwayInfo ?? {}
}

export function setupVisibilityRefresh(): () => void {
  const handler = () => {
    if (document.visibilityState === 'visible') {
      const { effectiveDate } = useCifpStore.getState()
      if (isCycleStale(effectiveDate)) {
        inflightPromise = fetchAndParseCifp()
        inflightPromise.then(() => { inflightPromise = null }).catch(console.error)
      }
    }
  }
  document.addEventListener('visibilitychange', handler)
  return () => document.removeEventListener('visibilitychange', handler)
}
