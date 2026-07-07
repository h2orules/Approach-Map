import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useProcedures } from '../useProcedures'
import { useAirportStore } from '../../store/useAirportStore'
import { useProcedureStore } from '../../store/useProcedureStore'
import type { Airport } from '../../types/airport'
import type { Procedure } from '../../types/procedure'

// useProcedures.ts warms CIFP data via ensureAirport/getProceduresForAirport
// (services/cifpCache.ts) before reading procedures for the selected airport.
// Those are mocked here so each scenario (unwarmed-but-present, missing,
// rapid double-switch) can be driven deterministically without a real IDB or
// Worker -- cifpCache.ts's own behavior (staleness, per-airport IDB layout)
// is covered separately in services/__tests__/cifpCache.test.ts.
const ensureAirportMock = vi.fn()
const getProceduresForAirportMock = vi.fn()

vi.mock('../../services/cifpCache', async () => {
  const actual = await vi.importActual<typeof import('../../services/cifpCache')>('../../services/cifpCache')
  return {
    ...actual,
    ensureAirport: (key: string) => ensureAirportMock(key),
    getProceduresForAirport: (icao: string) => getProceduresForAirportMock(icao),
  }
})

// Imported after the mock so it picks up the mocked exports (the real
// `useCifpStore` still comes through via `...actual`).
import { useCifpStore } from '../../services/cifpCache'

function airport(icao: string): Airport {
  return { icao, iata: '', name: icao, lat: 0, lon: 0, elevation: 0, city: '', state: '' }
}

function proc(icao: string, name: string): Procedure {
  return {
    id: `${icao}-${name}`,
    icao,
    name,
    type: 'APPROACH',
    runways: [],
    waypoints: [],
    symbols: [],
    geojson: { type: 'FeatureCollection', features: [] },
    hasGeometry: true,
    color: '#34d399',
  }
}

describe('useProcedures', () => {
  beforeEach(() => {
    ensureAirportMock.mockReset()
    getProceduresForAirportMock.mockReset()
    useAirportStore.setState({ selectedAirport: null })
    useProcedureStore.getState().setProcedures([])
    useProcedureStore.setState({ loading: false, error: null })
    useCifpStore.setState({
      status: 'ready',
      data: {},
      airportKeys: [],
      effectiveDate: null,
      error: null,
      progress: 0,
      progressMessage: '',
    })
  })

  it('warms an unwarmed-but-present airport, then transitions loading -> procedures set', async () => {
    let resolveEnsure!: (v: boolean) => void
    ensureAirportMock.mockReturnValue(new Promise<boolean>((resolve) => { resolveEnsure = resolve }))
    getProceduresForAirportMock.mockReturnValue([proc('KSEA', 'I16C')])

    renderHook(() => useProcedures())
    act(() => {
      useAirportStore.getState().setSelectedAirport(airport('KSEA'))
    })

    await waitFor(() => expect(useProcedureStore.getState().loading).toBe(true))
    expect(useProcedureStore.getState().procedures).toEqual([])
    expect(ensureAirportMock).toHaveBeenCalledWith('KSEA')

    await act(async () => {
      resolveEnsure(true)
      await Promise.resolve()
    })

    await waitFor(() => expect(useProcedureStore.getState().loading).toBe(false))
    expect(useProcedureStore.getState().procedures.map((p) => p.id)).toEqual(['KSEA-I16C'])
    expect(useProcedureStore.getState().error).toBeNull()
  })

  it('sets an error when the airport has no procedures in the CIFP data (unknown/empty key)', async () => {
    ensureAirportMock.mockResolvedValue(false)
    getProceduresForAirportMock.mockReturnValue([])

    renderHook(() => useProcedures())
    act(() => {
      useAirportStore.getState().setSelectedAirport(airport('KZZZ'))
    })

    await waitFor(() => expect(useProcedureStore.getState().loading).toBe(false))
    expect(useProcedureStore.getState().error).toBe('No procedures found in CIFP data for this airport')
    expect(useProcedureStore.getState().procedures).toEqual([])
  })

  it('does not let a stale ensureAirport resolution clobber a rapid second airport switch', async () => {
    let resolveFirst!: (v: boolean) => void
    const firstPromise = new Promise<boolean>((resolve) => { resolveFirst = resolve })

    getProceduresForAirportMock.mockImplementation((icao: string) =>
      icao === 'KSEA' ? [proc('KSEA', 'I16C')] : [proc('KPAE', 'I16')],
    )
    ensureAirportMock.mockImplementation((icao: string) => (icao === 'KSEA' ? firstPromise : Promise.resolve(true)))

    renderHook(() => useProcedures())
    act(() => {
      useAirportStore.getState().setSelectedAirport(airport('KSEA'))
    })
    await waitFor(() => expect(ensureAirportMock).toHaveBeenCalledWith('KSEA'))

    // Switch airports before the first (KSEA) ensureAirport call resolves.
    act(() => {
      useAirportStore.getState().setSelectedAirport(airport('KPAE'))
    })
    await waitFor(() => expect(useProcedureStore.getState().procedures.map((p) => p.id)).toEqual(['KPAE-I16']))
    expect(useProcedureStore.getState().loading).toBe(false)

    // Now the stale KSEA promise resolves -- it must not clobber KPAE's procedures.
    await act(async () => {
      resolveFirst(true)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(useProcedureStore.getState().procedures.map((p) => p.id)).toEqual(['KPAE-I16'])
    expect(useProcedureStore.getState().loading).toBe(false)
  })

  it('shows loading and does not read procedures while the CIFP index itself is not ready', () => {
    useCifpStore.setState({ status: 'parsing' })

    renderHook(() => useProcedures())
    act(() => {
      useAirportStore.getState().setSelectedAirport(airport('KSEA'))
    })

    expect(useProcedureStore.getState().loading).toBe(true)
    expect(ensureAirportMock).not.toHaveBeenCalled()
  })
})
