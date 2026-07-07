import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { parseIndexRows } from '../useAirportSearch'
import type { Airport } from '../../types/airport'

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response
}

describe('parseIndexRows', () => {
  it('maps a well-formed index row to an Airport + its counts entry', () => {
    const { airports, counts } = parseIndexRows([
      {
        key: 'KSEA',
        icao: 'KSEA',
        name: 'Seattle-Tacoma Intl',
        city: 'Seattle',
        state: 'WA',
        lat: 47.45,
        lon: -122.31,
        elev: 433,
        s: 3,
        t: 2,
        a: 5,
      },
    ])
    expect(airports).toEqual([
      {
        key: 'KSEA',
        icao: 'KSEA',
        iata: '',
        name: 'Seattle-Tacoma Intl',
        city: 'Seattle',
        state: 'WA',
        lat: 47.45,
        lon: -122.31,
        elevation: 433,
      },
    ])
    expect(counts.get('KSEA')).toEqual({ s: 3, t: 2, a: 5 })
  })

  it('sets icao to key for LID-only rows (no icao field in the row)', () => {
    const { airports } = parseIndexRows([
      { key: 'A09', name: 'Middle Something Field', city: 'Middletown', state: 'CA', lat: 1, lon: 2, elev: 0, s: 0, t: 0, a: 1 },
    ])
    expect(airports).toHaveLength(1)
    expect(airports[0].key).toBe('A09')
    expect(airports[0].icao).toBe('A09')
  })

  it('skips malformed rows (missing key/name/lat/lon, non-objects) but keeps well-formed ones', () => {
    const { airports, counts } = parseIndexRows([
      { name: 'no key', lat: 1, lon: 2 }, // missing key
      { key: 'X', lat: 1, lon: 2 }, // missing name
      { key: 'Y', name: 'no lat' }, // missing lat/lon
      { key: 'Z', name: 'bad lat', lat: '1', lon: 2 }, // lat wrong type
      null,
      42,
      'garbage',
      { key: 'GOOD', name: 'Good Airport', city: 'C', state: 'S', lat: 1, lon: 2, elev: 10, s: 1, t: 1, a: 1 },
    ])
    expect(airports).toHaveLength(1)
    expect(airports[0].key).toBe('GOOD')
    expect(counts.size).toBe(1)
  })

  it('defaults missing optional fields (icao/city/state/elev/counts)', () => {
    const { airports, counts } = parseIndexRows([{ key: 'K1', name: 'Bare Row', lat: 1, lon: 2 }])
    expect(airports[0]).toMatchObject({ icao: 'K1', city: '', state: '', elevation: 0 })
    expect(counts.get('K1')).toEqual({ s: 0, t: 0, a: 0 })
  })

  it('throws for non-array input so the caller can fall back to the legacy list', () => {
    expect(() => parseIndexRows({ not: 'an array' })).toThrow()
    expect(() => parseIndexRows(null)).toThrow()
    expect(() => parseIndexRows('garbage')).toThrow()
    expect(() => parseIndexRows(undefined)).toThrow()
  })
})

describe('useAirportSearch (module-level loader + Fuse search)', () => {
  // useAirportSearch.ts memoizes the loaded airport list at module scope
  // (`cached`/`loadPromise`), so each test needs a fresh module instance to
  // exercise the loader from a clean slate.
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('falls back to legacy airports.json when the index fetch fails, warning exactly once', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/data/airport-index.json') return jsonResponse({}, false, 404)
      if (url === '/data/airports.json') {
        return jsonResponse([
          { icao: 'KSEA', iata: 'SEA', name: 'Seattle-Tacoma Intl', city: 'Seattle', state: 'WA', lat: 47.45, lon: -122.31, elevation: 433 },
        ] satisfies Airport[])
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { useAirportSearch, getAirportByIcao } = await import('../useAirportSearch')
    const { result } = renderHook(() => useAirportSearch('sea'))

    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0))

    expect(fetchMock).toHaveBeenCalledWith('/data/airport-index.json')
    expect(fetchMock).toHaveBeenCalledWith('/data/airports.json')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(result.current.results[0].icao).toBe('KSEA')
    // Legacy list has no counts data.
    expect(result.current.counts.size).toBe(0)

    // getAirportByIcao resolves case-insensitively against whichever source loaded.
    expect(getAirportByIcao('ksea')?.name).toBe('Seattle-Tacoma Intl')
    expect(getAirportByIcao('KXXX')).toBeUndefined()
  })

  it('uses the index when it loads successfully, exposing per-airport counts and no warning', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/data/airport-index.json') {
        return jsonResponse([
          { key: 'KPAE', icao: 'KPAE', name: 'Paine Field', city: 'Everett', state: 'WA', lat: 47.9, lon: -122.28, elev: 606, s: 1, t: 0, a: 4 },
        ])
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { useAirportSearch, getAirportByIcao } = await import('../useAirportSearch')
    const { result } = renderHook(() => useAirportSearch('paine'))

    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0))

    expect(fetchMock).not.toHaveBeenCalledWith('/data/airports.json')
    expect(warnSpy).not.toHaveBeenCalled()
    expect(result.current.counts.get('KPAE')).toEqual({ s: 1, t: 0, a: 4 })
    expect(getAirportByIcao('kpae')?.city).toBe('Everett')
  })

  it('finds airports by icao/key/name/city over a large synthetic index, including LID-only airports by their key, and caps results at 8', async () => {
    const rows: unknown[] = []
    for (let i = 0; i < 3000; i++) {
      rows.push({
        key: `Z${String(i).padStart(3, '0')}`,
        icao: `Z${String(i).padStart(3, '0')}`,
        name: `Filler Airfield ${i}`,
        city: `Fillertown ${i}`,
        state: 'ZZ',
        lat: 30 + (i % 10),
        lon: -90 - (i % 10),
        elev: 100,
        s: 0,
        t: 0,
        a: 0,
      })
    }
    // A handful of very findable entries, including a LID-only airport (no icao).
    rows.push({ key: 'KSEA', icao: 'KSEA', name: 'Seattle-Tacoma Intl', city: 'Seattle', state: 'WA', lat: 47.45, lon: -122.31, elev: 433, s: 3, t: 2, a: 5 })
    rows.push({ key: 'A09', name: 'Middletown Airpark', city: 'Middletown', state: 'CA', lat: 38.7, lon: -122.6, elev: 700, s: 0, t: 0, a: 1 })

    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/data/airport-index.json') return jsonResponse(rows)
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { useAirportSearch } = await import('../useAirportSearch')

    // Findable by ICAO.
    const bySea = renderHook(() => useAirportSearch('KSEA'))
    await waitFor(() => expect(bySea.result.current.results.length).toBeGreaterThan(0))
    expect(bySea.result.current.results.length).toBeLessThanOrEqual(8)
    expect(bySea.result.current.results.some((a) => a.icao === 'KSEA')).toBe(true)

    // Findable by name.
    const byName = renderHook(() => useAirportSearch('Seattle-Tacoma'))
    await waitFor(() => expect(byName.result.current.results.some((a) => a.icao === 'KSEA')).toBe(true))

    // LID-only airport findable by its 3-char key (no true ICAO exists for it).
    const byKey = renderHook(() => useAirportSearch('A09'))
    await waitFor(() => expect(byKey.result.current.results.some((a) => a.key === 'A09')).toBe(true))
    expect(byKey.result.current.results.find((a) => a.key === 'A09')?.icao).toBe('A09')

    // LID-only airport findable by its name/city too.
    const byCity = renderHook(() => useAirportSearch('Middletown'))
    await waitFor(() => expect(byCity.result.current.results.some((a) => a.key === 'A09')).toBe(true))
  })
})
