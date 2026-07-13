// Memory-only LRU of decoded Mapbox terrain-rgb tiles, used by the terrain
// scan (src/geo/terrainScan.ts) as the ground-elevation fallback wherever no
// MVA sector covers a predicted point.
//
// Reads are synchronous and cache-only: `elevationFtAt` never awaits a
// network round-trip. If the covering tile isn't decoded yet it kicks off an
// async fetch+decode (deduped per tile key) and returns undefined; the caller
// (a per-poll scan) just skips that point and picks it up again next poll
// once the tile has landed.
//
// Tile format: Mapbox v4 terrain-rgb pngraw tiles are 256x256 (verified by
// reading the decoded bitmap's own dimensions rather than assuming — see
// `decodeTerrainTile`/`fetchAndDecode`). Decoded tiles are stored as
// Int16Array feet (not Float32Array meters) to bound memory: 256*256*2 bytes
// = 128 KiB/tile, so TERRAIN_TILE_CACHE_MAX (48) tiles cost at most
// 48 * 128 KiB ~= 6 MiB resident. Feet fit comfortably in an Int16 (max
// terrain-rgb range is roughly -11000..+9000 m, i.e. about -36000..+30000 ft).
import { FEET_PER_METER, TERRAIN_TILE_CACHE_MAX, TERRAIN_TILE_ZOOM } from '../config/constants'

/** Raw RGBA pixels decoded from a terrain-rgb tile image, plus its (square) side length. */
export interface DecodedTileBlob {
  rgba: Uint8ClampedArray
  size: number
}

/** Injectable blob -> pixel decode step, so tests never need canvas/jsdom support. */
export type TileBlobDecoder = (blob: Blob) => Promise<DecodedTileBlob>

interface ReadyTile {
  status: 'ready'
  size: number
  feet: Int16Array
}

interface PendingTile {
  status: 'pending'
}

interface FailedTile {
  status: 'failed'
  retryAtMs: number
}

type TileEntry = ReadyTile | PendingTile | FailedTile

// Backoff before retrying a tile whose fetch/decode failed (missing token,
// network error, non-2xx, decode error) — avoids hot-looping a bad tile.
const FAILED_RETRY_MS = 60_000

const tileCache = new Map<string, TileEntry>()

function tileKey(x: number, y: number): string {
  return `${TERRAIN_TILE_ZOOM}/${x}/${y}`
}

/** Web Mercator slippy-tile math: which tile a lon/lat falls in, plus its fractional position within that tile (0..1, top-left origin). */
function lonLatToTile(
  lon: number,
  lat: number,
  zoom: number,
): { x: number; y: number; fx: number; fy: number } {
  const latRad = (lat * Math.PI) / 180
  const n = 2 ** zoom
  const xFrac = ((lon + 180) / 360) * n
  const yFrac = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  const x = Math.floor(xFrac)
  const y = Math.floor(yFrac)
  return { x, y, fx: xFrac - x, fy: yFrac - y }
}

/**
 * Decodes terrain-rgb pixels into elevation meters, one value per pixel
 * (row-major). Pure and canvas-free so it's directly unit-testable.
 * Formula: elevation = -10000 + (R*65536 + G*256 + B) * 0.1
 */
export function decodeTerrainTile(rgba: Uint8ClampedArray, size: number): Float32Array {
  const out = new Float32Array(size * size)
  for (let i = 0; i < size * size; i++) {
    const r = rgba[i * 4]
    const g = rgba[i * 4 + 1]
    const b = rgba[i * 4 + 2]
    out[i] = -10000 + (r * 65536 + g * 256 + b) * 0.1
  }
  return out
}

/** Default blob decoder: browser-only (createImageBitmap + OffscreenCanvas). Swappable via `_setTileDecoder` in tests. */
async function defaultTileBlobDecoder(blob: Blob): Promise<DecodedTileBlob> {
  const bitmap = await createImageBitmap(blob)
  const size = bitmap.width
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable')
  ctx.drawImage(bitmap, 0, 0)
  const { data } = ctx.getImageData(0, 0, size, size)
  return { rgba: data, size }
}

let tileBlobDecoder: TileBlobDecoder = defaultTileBlobDecoder

/** Test seam: swap the blob->pixels step so vitest/jsdom never needs canvas. */
export function _setTileDecoder(decoder: TileBlobDecoder): void {
  tileBlobDecoder = decoder
}

/** Moves an existing cache entry to the end of the Map (most-recently-used) without changing its value. */
function touch(key: string): void {
  const entry = tileCache.get(key)
  if (entry === undefined) return
  tileCache.delete(key)
  tileCache.set(key, entry)
}

/** Evicts least-recently-used entries (Map iteration order) until at/under the cap. */
function evictIfNeeded(): void {
  while (tileCache.size > TERRAIN_TILE_CACHE_MAX) {
    const oldestKey = tileCache.keys().next().value
    if (oldestKey === undefined) break
    tileCache.delete(oldestKey)
  }
}

async function fetchAndDecode(x: number, y: number): Promise<{ size: number; feet: Int16Array }> {
  const token = import.meta.env.VITE_MAPBOX_TOKEN
  if (!token) throw new Error('VITE_MAPBOX_TOKEN is not configured')

  const url = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${TERRAIN_TILE_ZOOM}/${x}/${y}.pngraw?access_token=${token}`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`terrain-rgb tile fetch failed: ${resp.status} ${resp.statusText}`)

  const blob = await resp.blob()
  const { rgba, size } = await tileBlobDecoder(blob)
  const meters = decodeTerrainTile(rgba, size)

  const feet = new Int16Array(meters.length)
  for (let i = 0; i < meters.length; i++) feet[i] = Math.round(meters[i] * FEET_PER_METER)

  return { size, feet }
}

/** Kicks off (or skips, if already pending/ready/backed-off) a fetch+decode for one tile. Fire-and-forget; result lands in `tileCache`. */
function ensureFetch(x: number, y: number): void {
  const key = tileKey(x, y)
  const entry = tileCache.get(key)
  if (entry?.status === 'ready' || entry?.status === 'pending') return
  if (entry?.status === 'failed' && Date.now() < entry.retryAtMs) return

  tileCache.set(key, { status: 'pending' })

  fetchAndDecode(x, y)
    .then((tile) => {
      tileCache.set(key, { status: 'ready', size: tile.size, feet: tile.feet })
      touch(key)
      evictIfNeeded()
    })
    .catch(() => {
      tileCache.set(key, { status: 'failed', retryAtMs: Date.now() + FAILED_RETRY_MS })
    })
}

/**
 * Synchronous elevation lookup in feet MSL. Returns undefined (and enqueues
 * an async fetch, deduped per tile) when the covering tile isn't decoded yet
 * — callers should skip the point and retry on the next poll.
 */
export function elevationFtAt(lat: number, lon: number): number | undefined {
  const { x, y, fx, fy } = lonLatToTile(lon, lat, TERRAIN_TILE_ZOOM)
  const key = tileKey(x, y)
  const entry = tileCache.get(key)

  if (entry?.status === 'ready') {
    touch(key)
    const px = Math.min(entry.size - 1, Math.floor(fx * entry.size))
    const py = Math.min(entry.size - 1, Math.floor(fy * entry.size))
    return entry.feet[py * entry.size + px]
  }

  ensureFetch(x, y)
  return undefined
}

/** Warms the 2x2 tiles nearest each point (the containing tile plus whichever neighbor the point sits closer to on each axis), so a subsequent `elevationFtAt` is more likely to hit. */
export function prefetchAround(points: { lat: number; lon: number }[]): void {
  for (const p of points) {
    const { x, y, fx, fy } = lonLatToTile(p.lon, p.lat, TERRAIN_TILE_ZOOM)
    const dx = fx < 0.5 ? -1 : 1
    const dy = fy < 0.5 ? -1 : 1
    for (const xx of [x, x + dx]) {
      for (const yy of [y, y + dy]) {
        ensureFetch(xx, yy)
      }
    }
  }
}

/** Test-only: clears the entire tile cache. */
export function _resetTerrainCache(): void {
  tileCache.clear()
}
