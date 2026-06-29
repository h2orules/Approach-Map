import { create } from 'zustand'
import { unzipSync } from 'fflate'
import type { Procedure } from '../types/procedure'
import { currentCycleEffectiveDate, nextCycleDate, cifpUrl, formatCycleDate, isCycleStale } from '../utils/airac'

const DB_NAME = 'approach-map-cifp'
const DB_VERSION = 1
const STORE_NAME = 'cifp'

// Bump whenever the ARINC 424 parser logic changes, so previously cached
// parse results (which may have been produced by buggy parser code) are
// discarded and the CIFP is re-parsed even within the same AIRAC cycle.
const PARSER_VERSION = 8

export type CifpStatus = 'idle' | 'fetching' | 'parsing' | 'ready' | 'error'

interface CifpStore {
  status: CifpStatus
  progress: number
  progressMessage: string
  effectiveDate: string | null
  data: Record<string, Procedure[]>
  error: string | null

  setStatus: (s: CifpStatus, progress?: number, message?: string) => void
  setData: (data: Record<string, Procedure[]>, effectiveDate: string) => void
  setError: (e: string) => void
}

export const useCifpStore = create<CifpStore>((set) => ({
  status: 'idle',
  progress: 0,
  progressMessage: '',
  effectiveDate: null,
  data: {},
  error: null,

  setStatus: (status, progress = 0, progressMessage = '') =>
    set({ status, progress, progressMessage }),
  setData: (data, effectiveDate) => set({ data, effectiveDate, status: 'ready', error: null }),
  setError: (error) => set({ error, status: 'error' }),
}))

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function dbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

async function dbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).put(value, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

let inflightPromise: Promise<void> | null = null
let rolloverTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRollover(): void {
  if (rolloverTimer) clearTimeout(rolloverTimer)
  const msUntilNext = nextCycleDate().getTime() - Date.now()
  rolloverTimer = setTimeout(() => {
    void fetchAndParseCifp()
  }, msUntilNext)
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
      const msg = e.data as { type: string; percent?: number; message?: string; data?: Record<string, Procedure[]>; message2?: string }
      if (msg.type === 'progress') {
        store.setStatus('parsing', msg.percent ?? 0, msg.message ?? '')
      } else if (msg.type === 'result') {
        const data = msg.data as Record<string, Procedure[]>
        store.setData(data, dateStr)
        openDb()
          .then((db) =>
            Promise.all([
              dbPut(db, 'data', data),
              dbPut(db, 'effectiveDate', dateStr),
              dbPut(db, 'parserVersion', PARSER_VERSION),
            ]),
          )
          .catch(console.error)
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
  const db = await openDb()
  const storedDate = await dbGet<string>(db, 'effectiveDate')
  const storedVersion = await dbGet<number>(db, 'parserVersion')

  if (storedVersion === PARSER_VERSION && !isCycleStale(storedDate ?? null)) {
    const data = await dbGet<Record<string, Procedure[]>>(db, 'data')
    if (data) {
      useCifpStore.getState().setData(data, storedDate!)
      scheduleRollover()
      return
    }
  }

  inflightPromise = fetchAndParseCifp()
  await inflightPromise
  inflightPromise = null
}

export async function getCifpData(): Promise<void> {
  if (inflightPromise) return inflightPromise
  return checkAndRefreshIfStale()
}

export function getProceduresForAirport(icao: string): Procedure[] {
  return useCifpStore.getState().data[icao.toUpperCase()] ?? []
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
