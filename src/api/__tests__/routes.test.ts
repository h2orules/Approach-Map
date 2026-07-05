import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { lookupRoutes, clearRouteCache, parseRoutesetResponse } from '../routes'
import { ROUTE_NEGATIVE_TTL_MS, ROUTE_RETRY_BASE_MS, ROUTE_RETRY_MAX_MS } from '../../config/constants'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response
}

describe('parseRoutesetResponse', () => {
  it('parses a found route', () => {
    const map = parseRoutesetResponse([
      {
        callsign: 'UAL123',
        airport_codes: 'KSEA-KLAX',
        _airports: [{ icao: 'KSEA' }, { icao: 'KLAX' }],
        plausible: 1,
      },
    ])
    expect(map.get('UAL123')).toEqual({
      callsign: 'UAL123',
      origin: 'KSEA',
      destination: 'KLAX',
      plausible: true,
      source: 'adsblol',
    })
  })

  it('uses the first/last airport for a multi-leg route', () => {
    const map = parseRoutesetResponse([
      {
        callsign: 'UAL456',
        airport_codes: 'KSEA-KDEN-KORD',
        _airports: [{ icao: 'KSEA' }, { icao: 'KDEN' }, { icao: 'KORD' }],
        plausible: true,
      },
    ])
    expect(map.get('UAL456')?.origin).toBe('KSEA')
    expect(map.get('UAL456')?.destination).toBe('KORD')
  })

  it('maps airport_codes "unknown" to null', () => {
    const map = parseRoutesetResponse([{ callsign: 'N123AB', airport_codes: 'unknown' }])
    expect(map.get('N123AB')).toBeNull()
  })

  it('maps plausible 0/1 to boolean', () => {
    const map = parseRoutesetResponse([
      {
        callsign: 'AAL1',
        airport_codes: 'KJFK-KLAX',
        _airports: [{ icao: 'KJFK' }, { icao: 'KLAX' }],
        plausible: 0,
      },
    ])
    expect(map.get('AAL1')?.plausible).toBe(false)
  })

  it('treats malformed items defensively as unknown, and drops items with no callsign', () => {
    const map = parseRoutesetResponse([
      { callsign: 'DAL1' }, // missing airport_codes/_airports entirely
      { callsign: 'DAL2', airport_codes: 'KABC-KXYZ', _airports: [] }, // empty airports
      { callsign: 'DAL3', airport_codes: 'KABC-KXYZ', _airports: [{ icao: 'KABC' }, {}] }, // missing icao
      {}, // no callsign at all
    ])
    expect(map.get('DAL1')).toBeNull()
    expect(map.get('DAL2')).toBeNull()
    expect(map.get('DAL3')).toBeNull()
    expect(map.size).toBe(3)
  })

  it('returns an empty map for non-array (malformed) input', () => {
    expect(parseRoutesetResponse({ not: 'an array' }).size).toBe(0)
    expect(parseRoutesetResponse(null).size).toBe(0)
    expect(parseRoutesetResponse('garbage').size).toBe(0)
  })
})

describe('lookupRoutes', () => {
  beforeEach(() => {
    clearRouteCache()
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('batches N candidates into a single routeset POST', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(
      jsonResponse([
        { callsign: 'UAL1', airport_codes: 'KSEA-KLAX', _airports: [{ icao: 'KSEA' }, { icao: 'KLAX' }], plausible: true },
        { callsign: 'UAL2', airport_codes: 'KSEA-KDEN', _airports: [{ icao: 'KSEA' }, { icao: 'KDEN' }], plausible: true },
        { callsign: 'UAL3', airport_codes: 'KSEA-KSFO', _airports: [{ icao: 'KSEA' }, { icao: 'KSFO' }], plausible: true },
      ]),
    )

    const result = await lookupRoutes([
      { callsign: 'UAL1', lat: 47, lon: -122 },
      { callsign: 'UAL2', lat: 47, lon: -122 },
      { callsign: 'UAL3', lat: 47, lon: -122 },
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/adsblol/routeset')
    expect(JSON.parse(init.body).planes).toHaveLength(3)
    expect(result.get('UAL1')?.destination).toBe('KLAX')
    expect(result.size).toBe(3)
  })

  it('only falls back to adsbdb for routeset misses', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/adsblol/routeset') {
        return jsonResponse([
          { callsign: 'UAL1', airport_codes: 'KSEA-KLAX', _airports: [{ icao: 'KSEA' }, { icao: 'KLAX' }], plausible: true },
          { callsign: 'N123AB', airport_codes: 'unknown' },
        ])
      }
      if (url === '/api/adsbdb/callsign/N123AB') {
        return jsonResponse({
          response: { flightroute: { origin: { icao_code: 'KBFI' }, destination: { icao_code: 'KPAE' } } },
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    const result = await lookupRoutes([
      { callsign: 'UAL1', lat: 47, lon: -122 },
      { callsign: 'N123AB', lat: 47, lon: -122 },
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith('/api/adsbdb/callsign/N123AB')
    expect(result.get('UAL1')?.origin).toBe('KSEA')
    expect(result.get('N123AB')).toEqual({
      callsign: 'N123AB',
      origin: 'KBFI',
      destination: 'KPAE',
      plausible: null,
      source: 'adsbdb',
    })
  })

  it('cascades to adsbdb when routeset returns a 2xx with an empty/unparseable body', async () => {
    // adsb.lol's routeset edge has returned bare 201s with an empty body; the
    // response is `ok` but `.json()` throws. This must degrade to adsbdb rather
    // than being treated as a transient failure that suppresses the fallback.
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/adsblol/routeset') {
        return {
          ok: true,
          status: 201,
          json: async () => {
            throw new SyntaxError('Unexpected end of JSON input')
          },
        } as unknown as Response
      }
      if (url === '/api/adsbdb/callsign/AAL100') {
        return jsonResponse({
          response: { flightroute: { origin: { icao_code: 'KJFK' }, destination: { icao_code: 'EGLL' } } },
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    const result = await lookupRoutes([{ callsign: 'AAL100', lat: 40.6, lon: -73.7 }])

    expect(fetchMock).toHaveBeenCalledWith('/api/adsbdb/callsign/AAL100')
    expect(result.get('AAL100')).toEqual({
      callsign: 'AAL100',
      origin: 'KJFK',
      destination: 'EGLL',
      plausible: null,
      source: 'adsbdb',
    })
  })

  it('negative-caches a confirmed miss and re-queries only after the TTL expires', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/adsblol/routeset') return jsonResponse([{ callsign: 'N999ZZ', airport_codes: 'unknown' }])
      if (url === '/api/adsbdb/callsign/N999ZZ') return jsonResponse({}, false, 404)
      throw new Error(`unexpected fetch ${url}`)
    })

    const query = [{ callsign: 'N999ZZ', lat: 47, lon: -122 }]
    const first = await lookupRoutes(query)
    expect(first.size).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockClear()
    const second = await lookupRoutes(query)
    expect(second.size).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled() // still within the negative TTL

    await vi.advanceTimersByTimeAsync(ROUTE_NEGATIVE_TTL_MS + 1)
    fetchMock.mockClear()
    await lookupRoutes(query)
    expect(fetchMock).toHaveBeenCalledTimes(2) // TTL expired -- re-queried
  })

  it('caches a positive result permanently', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(
      jsonResponse([
        { callsign: 'UAL1', airport_codes: 'KSEA-KLAX', _airports: [{ icao: 'KSEA' }, { icao: 'KLAX' }], plausible: true },
      ]),
    )

    const query = [{ callsign: 'UAL1', lat: 47, lon: -122 }]
    await lookupRoutes(query)
    fetchMock.mockClear()

    await vi.advanceTimersByTimeAsync(1000 * 60 * 60 * 24 * 100) // 100 days later
    const result = await lookupRoutes(query)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.get('UAL1')?.destination).toBe('KLAX')
  })

  it('never caches a transient failure and backs off exponentially up to the cap', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(jsonResponse({}, false, 500))

    const query = [{ callsign: 'UAL1', lat: 47, lon: -122 }]
    const first = await lookupRoutes(query)
    expect(first.size).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1) // adsbdb never consulted for a transient miss

    // Still inside the first backoff window (ROUTE_RETRY_BASE_MS) -- no retry.
    fetchMock.mockClear()
    await vi.advanceTimersByTimeAsync(ROUTE_RETRY_BASE_MS - 1000)
    await lookupRoutes(query)
    expect(fetchMock).not.toHaveBeenCalled()

    // Past the first window -- retries, fails again, backoff doubles.
    await vi.advanceTimersByTimeAsync(2000)
    await lookupRoutes(query)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockClear()
    await vi.advanceTimersByTimeAsync(ROUTE_RETRY_BASE_MS * 2 - 1000)
    await lookupRoutes(query)
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    await lookupRoutes(query)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Backoff is capped at ROUTE_RETRY_MAX_MS no matter how many times it fails.
    fetchMock.mockClear()
    await vi.advanceTimersByTimeAsync(ROUTE_RETRY_MAX_MS + 1000)
    await lookupRoutes(query)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('dedups overlapping in-flight lookups for the same callsign', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    let resolveFetch!: (v: unknown) => void
    const inFlight = new Promise((resolve) => {
      resolveFetch = resolve
    })
    fetchMock.mockImplementation(() => inFlight)

    const query = [{ callsign: 'UAL1', lat: 47, lon: -122 }]
    const call1 = lookupRoutes(query)
    const call2 = lookupRoutes(query) // fires while call1's fetch is still in flight

    resolveFetch(
      jsonResponse([
        { callsign: 'UAL1', airport_codes: 'KSEA-KLAX', _airports: [{ icao: 'KSEA' }, { icao: 'KLAX' }], plausible: true },
      ]),
    )

    const [result1, result2] = await Promise.all([call1, call2])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result1.get('UAL1')?.destination).toBe('KLAX')
    expect(result2.size).toBe(0) // the overlapping call saw UAL1 as pending and skipped it
  })
})
