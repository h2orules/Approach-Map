import { create } from 'zustand'
import type { MvaSector } from '../utils/aixmMva'
import { parseMvaAixm } from '../utils/aixmMva'
import { MVA_FACILITIES } from '../utils/mvaFacilities'

const DB_NAME = 'approach-map-mva'
const DB_VERSION = 1
const STORE_NAME = 'mva'
// MVA/MIA charts are not AIRAC-cycled (unlike CIFP/d-TPP) — FAA updates them
// ad hoc. 30 days is an arbitrary "recheck occasionally" window, not tied to
// any published revision cadence.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export type MvaStatus = 'idle' | 'loading' | 'ready' | 'error'

interface CachedFacility {
  facility: string
  fetchedAt: number
  sectors: MvaSector[]
}

interface MvaStore {
  status: MvaStatus
  byIcao: Record<string, MvaSector[]>

  setLoading: () => void
  setSectors: (icao: string, sectors: MvaSector[]) => void
  setError: () => void
}

export const useMvaStore = create<MvaStore>((set) => ({
  status: 'idle',
  byIcao: {},

  setLoading: () => set({ status: 'loading' }),
  setSectors: (icao, sectors) =>
    set((s) => ({ status: 'ready', byIcao: { ...s.byIcao, [icao]: sectors } })),
  setError: () => set({ status: 'error' }),
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

const inflightByIcao = new Map<string, Promise<void>>()

/**
 * Loads MVA/MIA sectors for `icao` into `useMvaStore.byIcao`, following
 * MVA_FACILITIES' ordered candidate facility IDs (see mvaFacilities.ts for
 * how unverified/best-effort those are). No-ops if already loaded this
 * session or if the airport has no known facility candidates. Every failure
 * mode (bad facility ID, 404, network error, unparsable XML) is non-fatal —
 * MvaLayer just renders nothing for that airport; see setError().
 */
export async function ensureMvaLoaded(icao: string): Promise<void> {
  const key = icao.toUpperCase()
  if (useMvaStore.getState().byIcao[key]) return // already loaded this session

  const inflight = inflightByIcao.get(key)
  if (inflight) {
    await inflight
    return
  }

  const promise = loadIcao(key)
  inflightByIcao.set(key, promise)
  try {
    await promise
  } finally {
    inflightByIcao.delete(key)
  }
}

async function loadIcao(icao: string): Promise<void> {
  const facilities = MVA_FACILITIES[icao]
  if (!facilities || facilities.length === 0) return // no known facility for this airport

  useMvaStore.getState().setLoading()

  try {
    const db = await openDb()

    // Prefer a fresh cache hit over a network round-trip, trying candidates
    // in order (first candidate is the "best guess" facility).
    for (const facility of facilities) {
      const cached = await dbGet<CachedFacility>(db, facility)
      if (cached && Date.now() - cached.fetchedAt < MAX_AGE_MS) {
        useMvaStore.getState().setSectors(icao, cached.sectors)
        return
      }
    }

    for (const facility of facilities) {
      const sectors = await fetchFacility(facility)
      if (sectors && sectors.length > 0) {
        useMvaStore.getState().setSectors(icao, sectors)
        await dbPut(db, facility, {
          facility,
          fetchedAt: Date.now(),
          sectors,
        } satisfies CachedFacility)
        return
      }
    }

    // Every candidate 404'd/failed to fetch — fall back to a stale cached
    // copy if one exists (an old MVA chart beats none), else report error.
    for (const facility of facilities) {
      const stale = await dbGet<CachedFacility>(db, facility)
      if (stale) {
        useMvaStore.getState().setSectors(icao, stale.sectors)
        return
      }
    }

    console.warn(
      `No MVA/MIA data found for ${icao} (tried facilities: ${facilities.join(', ')}). ` +
        'The upstream URL/facility-ID guesses in vite.config.ts and mvaFacilities.ts may need fixing.',
    )
    useMvaStore.getState().setError()
  } catch (err) {
    console.error(`Failed to load MVA/MIA data for ${icao}:`, err)
    useMvaStore.getState().setError()
  }
}

/** Tries `<facility>_MVA_FUS3.xml` then `_FUS5.xml`; null if both fail. */
async function fetchFacility(facility: string): Promise<MvaSector[] | null> {
  for (const suffix of ['_MVA_FUS3.xml', '_MVA_FUS5.xml']) {
    try {
      const resp = await fetch(`/api/faa-mva/${facility}${suffix}`)
      if (!resp.ok) continue
      const text = await resp.text()
      const sectors = parseMvaAixm(text)
      if (sectors.length > 0) return sectors
    } catch {
      // Network error — try the next suffix/facility candidate.
    }
  }
  return null
}
