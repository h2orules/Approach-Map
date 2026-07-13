import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  decodeTerrainTile,
  elevationFtAt,
  prefetchAround,
  _setTileDecoder,
  _resetTerrainCache,
  type DecodedTileBlob,
} from '../terrainElevation'
import { FEET_PER_METER, TERRAIN_TILE_CACHE_MAX } from '../../config/constants'

// A tiny synthetic "tile": 2x2 pixels, RGBA. Encodes elevation meters as
// R*65536 + G*256 + B, offset by -10000 per the terrain-rgb formula.
function rgbaForMeters(meters: number): [number, number, number] {
  const encoded = Math.round((meters + 10000) / 0.1)
  const r = Math.floor(encoded / 65536) % 256
  const g = Math.floor(encoded / 256) % 256
  const b = encoded % 256
  return [r, g, b]
}

function makeFakeTile(size: number, metersPerPixel: number[]): DecodedTileBlob {
  const rgba = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const [r, g, b] = rgbaForMeters(metersPerPixel[i] ?? metersPerPixel[0])
    rgba[i * 4] = r
    rgba[i * 4 + 1] = g
    rgba[i * 4 + 2] = b
    rgba[i * 4 + 3] = 255
  }
  return { rgba, size }
}

beforeEach(() => {
  _resetTerrainCache()
  vi.stubGlobal('fetch', vi.fn())
  vi.stubEnv('VITE_MAPBOX_TOKEN', 'test-token')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('decodeTerrainTile', () => {
  it('decodes the terrain-rgb formula for 0 m, 1000 m, and negative elevations', () => {
    const rgba = new Uint8ClampedArray(3 * 4)
    const cases = [0, 1000, -500]
    cases.forEach((meters, i) => {
      const [r, g, b] = rgbaForMeters(meters)
      rgba[i * 4] = r
      rgba[i * 4 + 1] = g
      rgba[i * 4 + 2] = b
      rgba[i * 4 + 3] = 255
    })

    // Treat as a 1-row-of-3 "tile" purely to exercise the loop; size*size
    // must equal the pixel count, so call per-pixel via a 1x1 decode instead.
    for (let i = 0; i < cases.length; i++) {
      const single = new Uint8ClampedArray(4)
      single.set(rgba.subarray(i * 4, i * 4 + 4))
      const out = decodeTerrainTile(single, 1)
      expect(out[0]).toBeCloseTo(cases[i], 1)
    }
  })
})

describe('elevationFtAt', () => {
  it('returns undefined before the covering tile is decoded, then a value once it lands', async () => {
    const blob = {} as Blob
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      blob: () => Promise.resolve(blob),
    })
    vi.stubGlobal('fetch', fetchMock)
    _setTileDecoder(() => Promise.resolve(makeFakeTile(2, [1000, 1000, 1000, 1000])))

    const lat = 47.45
    const lon = -122.31

    expect(elevationFtAt(lat, lon)).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Let the fetch+decode microtasks resolve.
    await vi.waitFor(() => {
      const v = elevationFtAt(lat, lon)
      expect(v).not.toBeUndefined()
    })

    const feet = elevationFtAt(lat, lon)
    expect(feet).toBeCloseTo(1000 * FEET_PER_METER, 0)
  })

  it('dedupes in-flight fetches for the same tile', async () => {
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise(() => {
          // never resolves during this test — keeps the tile "pending"
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    _setTileDecoder(() => Promise.resolve(makeFakeTile(2, [0, 0, 0, 0])))

    const lat = 47.45
    const lon = -122.31
    expect(elevationFtAt(lat, lon)).toBeUndefined()
    expect(elevationFtAt(lat, lon)).toBeUndefined()
    expect(elevationFtAt(lat, lon)).toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a failed fetch does not refetch immediately', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'boom',
      blob: () => Promise.resolve({} as Blob),
    })
    vi.stubGlobal('fetch', fetchMock)
    _setTileDecoder(() => Promise.resolve(makeFakeTile(2, [0, 0, 0, 0])))

    const lat = 47.45
    const lon = -122.31
    expect(elevationFtAt(lat, lon)).toBeUndefined()

    // Wait for the failure to land in the cache (as a "failed" marker).
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    // Give the rejection's .catch() a turn to run.
    await Promise.resolve()
    await Promise.resolve()

    expect(elevationFtAt(lat, lon)).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1) // still within the retry-after backoff
  })
})

describe('LRU eviction', () => {
  it('evicts the least-recently-used tile once the cache exceeds its cap', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      blob: () => Promise.resolve({} as Blob),
    })
    vi.stubGlobal('fetch', fetchMock)
    _setTileDecoder(() => Promise.resolve(makeFakeTile(2, [0, 0, 0, 0])))

    // Distinct tile coordinates: spread points far enough apart in longitude
    // that each maps to a different slippy tile at TERRAIN_TILE_ZOOM. Resolved
    // strictly sequentially so cache insertion order is deterministic.
    const points: { lat: number; lon: number }[] = []
    for (let i = 0; i < TERRAIN_TILE_CACHE_MAX + 1; i++) {
      points.push({ lat: 0, lon: -170 + i * 2 })
    }

    for (const p of points) {
      expect(elevationFtAt(p.lat, p.lon)).toBeUndefined()
      await vi.waitFor(() => {
        expect(elevationFtAt(p.lat, p.lon)).not.toBeUndefined()
      })
    }

    // The first tile requested is the least-recently-used and should have
    // been evicted once the (cap + 1)th tile landed; re-requesting it issues
    // a new fetch call.
    const callsBefore = fetchMock.mock.calls.length
    expect(elevationFtAt(points[0].lat, points[0].lon)).toBeUndefined()
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore)
  })
})

describe('prefetchAround', () => {
  it('warms tiles around each point without throwing', () => {
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    prefetchAround([{ lat: 47.45, lon: -122.31 }])
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0)
  })
})
