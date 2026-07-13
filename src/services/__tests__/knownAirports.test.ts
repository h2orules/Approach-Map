import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  warmKnownAirports,
  getKnownAirports,
  airportsNear,
  _resetKnownAirports,
} from '../knownAirports'

/** A fetch mock whose first ok/json is the index, optionally a second for legacy. */
function mockFetchSequence(responses: Array<{ ok: boolean; json?: unknown; status?: number }>) {
  let call = 0
  const fetchMock = vi.fn().mockImplementation(() => {
    const r = responses[Math.min(call, responses.length - 1)]
    call++
    return Promise.resolve({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 404),
      json: () => Promise.resolve(r.json),
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Wait for the async warm chain to settle (a macrotask flushes its microtasks). */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  _resetKnownAirports()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('knownAirports — warming from the index', () => {
  it('is empty before warming', () => {
    expect(getKnownAirports()).toHaveLength(0)
  })

  it('loads the all-US index (elev field) into { lat, lon, elevationFt }', async () => {
    mockFetchSequence([
      {
        ok: true,
        json: [
          { key: 'KPAE', lat: 47.9, lon: -122.28, elev: 606 },
          { key: 'KSEA', lat: 47.45, lon: -122.31, elev: 433 },
        ],
      },
    ])
    warmKnownAirports()
    await flush()
    expect(getKnownAirports()).toEqual([
      { lat: 47.9, lon: -122.28, elevationFt: 606 },
      { lat: 47.45, lon: -122.31, elevationFt: 433 },
    ])
  })

  it('is idempotent — a second warm does not refetch', async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: [{ key: 'KPAE', lat: 47.9, lon: -122.28, elev: 606 }] },
    ])
    warmKnownAirports()
    await flush()
    warmKnownAirports()
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('knownAirports — legacy fallback', () => {
  it('falls back to airports.json (elevation field) on a 404 index', async () => {
    mockFetchSequence([
      { ok: false, status: 404 },
      { ok: true, json: [{ icao: 'KPAE', lat: 47.9, lon: -122.28, elevation: 606 }] },
    ])
    warmKnownAirports()
    await flush()
    expect(getKnownAirports()).toEqual([{ lat: 47.9, lon: -122.28, elevationFt: 606 }])
  })
})

describe('knownAirports — malformed rows', () => {
  it('skips rows without coordinates and defaults missing elevation to 0', async () => {
    mockFetchSequence([
      {
        ok: true,
        json: [
          { key: 'GOOD', lat: 47.9, lon: -122.28 }, // no elevation → 0
          { key: 'NOLAT', lon: -122.28, elev: 100 }, // no lat → skipped
          { key: 'NANLAT', lat: NaN, lon: -122.28, elev: 100 }, // NaN → skipped
          null, // → skipped
          'nope', // → skipped
        ],
      },
    ])
    warmKnownAirports()
    await flush()
    expect(getKnownAirports()).toEqual([{ lat: 47.9, lon: -122.28, elevationFt: 0 }])
  })

  it('leaves the list empty when the payload is not an array', async () => {
    mockFetchSequence([{ ok: true, json: { not: 'an array' } }])
    warmKnownAirports()
    await flush()
    expect(getKnownAirports()).toHaveLength(0)
  })
})

describe('airportsNear', () => {
  beforeEach(async () => {
    mockFetchSequence([
      {
        ok: true,
        json: [
          { key: 'KPAE', lat: 47.906, lon: -122.281, elev: 606 }, // Everett
          { key: 'KSEA', lat: 47.449, lon: -122.309, elev: 433 }, // ~27 nm south
          { key: 'KJFK', lat: 40.64, lon: -73.78, elev: 13 }, // far away
        ],
      },
    ])
    warmKnownAirports()
    await flush()
  })

  it('returns airports within the radius and excludes those outside', () => {
    const near = airportsNear(47.906, -122.281, 40)
    expect(near.map((a) => a.elevationFt).sort((x, y) => x - y)).toEqual([433, 606])
  })

  it('excludes airports beyond the radius', () => {
    const near = airportsNear(47.906, -122.281, 10)
    expect(near).toEqual([{ lat: 47.906, lon: -122.281, elevationFt: 606 }])
  })

  it('is empty before warming', () => {
    _resetKnownAirports()
    expect(airportsNear(47.906, -122.281, 100)).toHaveLength(0)
  })
})
