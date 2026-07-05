import { create } from 'zustand'
import type { AirspaceSector } from '../types/airspace'
import { fetchAirspace, type AirspaceBBox } from '../api/faaAirspace'
import { AIRSPACE_FETCH_HALF_DEG, AIRSPACE_CACHE_MAX_AGE_MS } from '../config/constants'

// Airspace polygons are keyed by the selected airport ICAO and cached in
// IndexedDB (the payload is a few MB per metro area, so re-fetching on every
// toggle would be wasteful). Mirrors src/services/mvaData.ts.
const DB_NAME = 'approach-map-airspace'
const DB_VERSION = 1
const STORE_NAME = 'airspace'

// Bump when the parse/shape of a cached record changes so stale entries are
// discarded rather than deserialized into the wrong shape.
const CACHE_VERSION = 1

export type AirspaceStatus = 'idle' | 'loading' | 'ready' | 'error'

interface CachedAirspace {
  version: number
  fetchedAt: number
  sectors: AirspaceSector[]
}

interface AirspaceStore {
  status: AirspaceStatus
  byIcao: Record<string, AirspaceSector[]>

  setLoading: () => void
  setSectors: (icao: string, sectors: AirspaceSector[]) => void
  setError: () => void
}

export const useAirspaceStore = create<AirspaceStore>((set) => ({
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

/** Square-ish WGS84 box around the airport: fixed N/S span, E/W widened by 1/cos(lat). */
function bboxAround(lat: number, lon: number): AirspaceBBox {
  const half = AIRSPACE_FETCH_HALF_DEG
  const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.2)
  const lonHalf = half / cos
  return { west: lon - lonHalf, south: lat - half, east: lon + lonHalf, north: lat + half }
}

const inflightByIcao = new Map<string, Promise<void>>()

/**
 * Loads Class B/C/D/E airspace around `icao` (centered on lat/lon) into
 * useAirspaceStore.byIcao. No-ops if already loaded this session. Serves a
 * fresh IndexedDB cache hit before hitting the network; every failure mode is
 * non-fatal (the layer just renders nothing) and reported via setError().
 */
export async function ensureAirspaceLoaded(icao: string, lat: number, lon: number): Promise<void> {
  const key = icao.toUpperCase()
  if (useAirspaceStore.getState().byIcao[key]) return // already loaded this session

  const inflight = inflightByIcao.get(key)
  if (inflight) return inflight

  const promise = loadIcao(key, lat, lon)
  inflightByIcao.set(key, promise)
  try {
    await promise
  } finally {
    inflightByIcao.delete(key)
  }
}

async function loadIcao(key: string, lat: number, lon: number): Promise<void> {
  useAirspaceStore.getState().setLoading()

  let db: IDBDatabase | null = null
  try {
    db = await openDb()
    const cached = await dbGet<CachedAirspace>(db, key)
    if (
      cached &&
      cached.version === CACHE_VERSION &&
      Date.now() - cached.fetchedAt < AIRSPACE_CACHE_MAX_AGE_MS
    ) {
      useAirspaceStore.getState().setSectors(key, cached.sectors)
      return
    }
  } catch {
    // IndexedDB unavailable (private mode, quota, etc.) — fall through to fetch.
  }

  try {
    const sectors = await fetchAirspace(bboxAround(lat, lon))
    useAirspaceStore.getState().setSectors(key, sectors)
    if (db) {
      try {
        await dbPut(db, key, {
          version: CACHE_VERSION,
          fetchedAt: Date.now(),
          sectors,
        } satisfies CachedAirspace)
      } catch {
        // Non-fatal: a failed cache write just means we re-fetch next session.
      }
    }
  } catch (err) {
    console.error(`Failed to load airspace for ${key}:`, err)
    useAirspaceStore.getState().setError()
  }
}
