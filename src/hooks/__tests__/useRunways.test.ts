import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { Airport, Runway } from '../../types/airport'
import type { CifpRunwayInfo } from '../../types/cifp'

// useRunways.ts resolves runways per airport through a 3-tier fallback chain:
// per-airport shard fetch -> legacy bundled runways.json -> CIFP synthesis
// (services/cifpCache.ts's ensureAirport/getRunwayInfoForAirport). Those two
// are mocked (as in useProcedures.test.ts) so each tier can be driven in
// isolation; fetch is stubbed per-URL to control the shard/legacy responses.
//
// useRunways.ts also memoizes the legacy runways.json fetch at module scope
// (`runwayDb`/`loadPromise`), so each test needs a fresh module instance (like
// useAirportSearch.test.ts's `cached`/`loadPromise`) — hence `vi.resetModules()`
// plus dynamically re-importing BOTH the hook and the store together so they
// share the same store instance (a statically-imported store from before the
// reset would be a different module instance than the one the freshly
// re-imported hook resolves internally).
const ensureAirportMock = vi.fn()
const getRunwayInfoForAirportMock = vi.fn()

vi.mock('../../services/cifpCache', async () => {
  const actual = await vi.importActual<typeof import('../../services/cifpCache')>('../../services/cifpCache')
  return {
    ...actual,
    ensureAirport: (icao: string) => ensureAirportMock(icao),
    getRunwayInfoForAirport: (icao: string) => getRunwayInfoForAirportMock(icao),
  }
})

function airport(icao: string): Airport {
  return { icao, iata: '', name: icao, lat: 0, lon: 0, elevation: 0, city: '', state: '' }
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response
}

function shardRunway(): Runway {
  return {
    id: 'SHARD-16/34',
    lengthFt: 9000,
    widthFt: 150,
    surfaceCode: '',
    lowEnd: { id: '16', heading: 160, lat: 1, lon: 2, displacedThresholdFt: 0 },
    highEnd: { id: '34', heading: 340, lat: 1.01, lon: 2, displacedThresholdFt: 0 },
  }
}

function legacyRunway(): Runway {
  return {
    id: 'LEGACY-16/34',
    lengthFt: 8000,
    widthFt: 150,
    surfaceCode: '',
    lowEnd: { id: '16', heading: 160, lat: 1, lon: 2, displacedThresholdFt: 0 },
    highEnd: { id: '34', heading: 340, lat: 1.01, lon: 2, displacedThresholdFt: 0 },
  }
}

function cifpRunwayInfo(): Record<string, CifpRunwayInfo> {
  return {
    RW16C: { id: 'RW16C', lat: 47.0, lon: -122.0, thresholdElevFt: 100, lengthFt: 9000 },
    RW34C: { id: 'RW34C', lat: 47.02, lon: -122.0, thresholdElevFt: 120, lengthFt: 9000 },
  }
}

/** Re-import the store + hook together (post `vi.resetModules()`) so both
 *  resolve to the SAME fresh module instance. */
async function freshHookAndStore() {
  const { useAirportStore } = await import('../../store/useAirportStore')
  const { useRunways } = await import('../useRunways')
  return { useAirportStore, useRunways }
}

describe('useRunways fallback chain', () => {
  beforeEach(() => {
    vi.resetModules()
    ensureAirportMock.mockReset()
    getRunwayInfoForAirportMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uses the per-airport shard when it 200s with runways, skipping legacy + CIFP synth', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/data/airports/KSEA.json') return jsonResponse({ runways: [shardRunway()] })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { useAirportStore, useRunways } = await freshHookAndStore()
    renderHook(() => useRunways())
    act(() => {
      useAirportStore.getState().addAirport(airport('KSEA'))
    })

    await waitFor(() => expect(useAirportStore.getState().runwaysByIcao.KSEA).toBeDefined())
    expect(useAirportStore.getState().runwaysByIcao.KSEA?.[0].id).toBe('SHARD-16/34')
    expect(fetchMock).not.toHaveBeenCalledWith('/data/runways.json')
    expect(ensureAirportMock).not.toHaveBeenCalled()
  })

  it('falls back to legacy runways.json when the shard 404s', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/data/airports/KSEA.json') return jsonResponse({}, false, 404)
      if (url === '/data/runways.json') return jsonResponse({ KSEA: [legacyRunway()] })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { useAirportStore, useRunways } = await freshHookAndStore()
    renderHook(() => useRunways())
    act(() => {
      useAirportStore.getState().addAirport(airport('KSEA'))
    })

    await waitFor(() => expect(useAirportStore.getState().runwaysByIcao.KSEA).toBeDefined())
    expect(useAirportStore.getState().runwaysByIcao.KSEA?.[0].id).toBe('LEGACY-16/34')
    expect(ensureAirportMock).not.toHaveBeenCalled()
  })

  it('synthesizes from CIFP runway info when both the shard and legacy data miss', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/data/airports/KSEA.json') return jsonResponse({}, false, 404)
      if (url === '/data/runways.json') return jsonResponse({}) // no KSEA entry
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    ensureAirportMock.mockResolvedValue(true)
    getRunwayInfoForAirportMock.mockReturnValue(cifpRunwayInfo())

    const { useAirportStore, useRunways } = await freshHookAndStore()
    renderHook(() => useRunways())
    act(() => {
      useAirportStore.getState().addAirport(airport('KSEA'))
    })

    await waitFor(() => expect(useAirportStore.getState().runwaysByIcao.KSEA).toBeDefined())
    expect(ensureAirportMock).toHaveBeenCalledWith('KSEA')
    expect(useAirportStore.getState().runwaysByIcao.KSEA?.[0].id).toBe('16C/34C')
  })

  it('sets an empty runway list when every tier fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/data/airports/KSEA.json') throw new Error('network down')
      if (url === '/data/runways.json') throw new Error('network down')
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    ensureAirportMock.mockRejectedValue(new Error('idb down'))

    const { useAirportStore, useRunways } = await freshHookAndStore()
    renderHook(() => useRunways())
    act(() => {
      useAirportStore.getState().addAirport(airport('KSEA'))
    })

    await waitFor(() => expect(useAirportStore.getState().runwaysByIcao.KSEA).toEqual([]))
  })

  it('does not write stale runways for an airport removed while its shard fetch was in flight', async () => {
    let resolveShard!: (r: Response) => void
    const shardPromise = new Promise<Response>((resolve) => { resolveShard = resolve })
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/data/airports/KSEA.json') return shardPromise
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { useAirportStore, useRunways } = await freshHookAndStore()
    renderHook(() => useRunways())
    act(() => {
      useAirportStore.getState().addAirport(airport('KSEA'))
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/data/airports/KSEA.json'))

    act(() => {
      useAirportStore.getState().removeAirport('KSEA')
    })

    await act(async () => {
      resolveShard(jsonResponse({ runways: [shardRunway()] }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(useAirportStore.getState().runwaysByIcao.KSEA).toBeUndefined()
  })
})
