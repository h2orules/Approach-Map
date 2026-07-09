import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { zipSync } from 'fflate'
import { createFakeStore } from '../db'
import type { CifpAirportData } from '../../types/cifp'
import { parseCifp } from '../../workers/cifpParse'
import { currentCycleEffectiveDate, formatCycleDate, nextCycleDate } from '../../utils/airac'

// cifpCache.ts spins up a real Web Worker (`new Worker(new URL(...), {type:
// 'module'})`) to run the parser off the main thread. Tests stub the global
// `Worker` with this fake so `fetchAndParseCifp()` can run end-to-end without
// a real worker thread -- it just hands back whatever `nextWorkerResult` is
// currently set to, mirroring the real worker's postMessage({type:'result',
// data}) contract.
let nextWorkerResult: Record<string, CifpAirportData> = {}

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor(_url: URL, _opts?: unknown) {}
  postMessage(_msg: unknown): void {
    const data = nextWorkerResult
    queueMicrotask(() => {
      this.onmessage?.({ data: { type: 'result', data } } as MessageEvent)
    })
  }
  terminate(): void {}
}

function zipFixtureArrayBuffer(): ArrayBuffer {
  const zipped = zipSync({ FAACIFP18: new TextEncoder().encode('dummy cifp text, ignored by FakeWorker') })
  // .slice() copies into its own exactly-sized buffer (zipSync's underlying
  // buffer isn't guaranteed to be trimmed to `byteLength`).
  return zipped.slice().buffer
}

function fetchOk(): Promise<Response> {
  return Promise.resolve({ ok: true, arrayBuffer: async () => zipFixtureArrayBuffer() } as unknown as Response)
}

function fetchFail(status = 500): Promise<Response> {
  return Promise.resolve({ ok: false, status } as unknown as Response)
}

const FAKE_KSEA: CifpAirportData = { procedures: [], safeAltitudes: [], runwayInfo: {}, magVarDeg: 15 }
const FAKE_KPAE: CifpAirportData = { procedures: [], safeAltitudes: [], runwayInfo: {}, magVarDeg: 20 }

/** cifpCache.ts holds module-level mutable state (`kv`, in-flight/rollover
 *  timers) plus a zustand store created at import time, so every test needs a
 *  fresh module instance to avoid leaking state between cases. */
async function freshCifpCache() {
  vi.resetModules()
  return await import('../cifpCache')
}

describe('cifpCache', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('Worker', FakeWorker)
    nextWorkerResult = {}
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('fresh parse', () => {
    it('writes one airport:<key> record per airport plus meta keys, and deletes any legacy "data" blob', async () => {
      const { __setKvStoreForTests, getCifpData, useCifpStore } = await freshCifpCache()
      const kv = createFakeStore({ data: { legacy: true } }) // pre-v21 blob lingering, no parserVersion at all
      __setKvStoreForTests(kv)
      fetchMock.mockImplementation(fetchOk)
      nextWorkerResult = { KSEA: FAKE_KSEA, KPAE: FAKE_KPAE }

      await getCifpData()

      expect(await kv.get('data')).toBeUndefined()
      expect(await kv.get('airport:KSEA')).toEqual(FAKE_KSEA)
      expect(await kv.get('airport:KPAE')).toEqual(FAKE_KPAE)
      expect(await kv.get('parserVersion')).toBe(21)
      expect(await kv.get('airportKeys')).toEqual(['KSEA', 'KPAE'])

      const state = useCifpStore.getState()
      expect(state.status).toBe('ready')
      // Right after a fresh parse the whole result is kept in memory (see
      // cifpCache.ts's documented memory model) -- only a *subsequent* cold
      // start benefits from the bounded-memory path.
      expect(state.data).toEqual(nextWorkerResult)
      expect(state.airportKeys).toEqual(['KSEA', 'KPAE'])
    })
  })

  describe('cold start with a valid on-disk index', () => {
    it('loads airportKeys but does not read any per-airport data until ensureAirport is called', async () => {
      const { __setKvStoreForTests, getCifpData, ensureAirport, useCifpStore } = await freshCifpCache()
      const dateStr = formatCycleDate(currentCycleEffectiveDate())
      const kv = createFakeStore({
        parserVersion: 21,
        effectiveDate: dateStr,
        airportKeys: ['KSEA', 'KPAE'],
        'airport:KSEA': FAKE_KSEA,
        'airport:KPAE': FAKE_KPAE,
      })
      const getSpy = vi.spyOn(kv, 'get')
      __setKvStoreForTests(kv)

      await getCifpData()

      expect(fetchMock).not.toHaveBeenCalled()
      const state = useCifpStore.getState()
      expect(state.status).toBe('ready')
      expect(state.data).toEqual({})
      expect(state.airportKeys).toEqual(['KSEA', 'KPAE'])
      expect(getSpy).not.toHaveBeenCalledWith('airport:KSEA')
      expect(getSpy).not.toHaveBeenCalledWith('airport:KPAE')

      // Warm exactly one airport on demand (case-insensitive key).
      const warmed = await ensureAirport('ksea')
      expect(warmed).toBe(true)
      expect(useCifpStore.getState().data).toEqual({ KSEA: FAKE_KSEA })
      expect(useCifpStore.getState().data.KPAE).toBeUndefined()

      // Idempotent: already-warmed airport needs no further IDB read.
      getSpy.mockClear()
      const warmedAgain = await ensureAirport('KSEA')
      expect(warmedAgain).toBe(true)
      expect(getSpy).not.toHaveBeenCalled()

      // Unknown key -- no record in IDB at all.
      const missing = await ensureAirport('ZZZZ')
      expect(missing).toBe(false)
      expect(useCifpStore.getState().data.ZZZZ).toBeUndefined()
    })
  })

  describe('staleness forces a full refetch even when airportKeys is present', () => {
    it('re-fetches when parserVersion is stale', async () => {
      const { __setKvStoreForTests, getCifpData } = await freshCifpCache()
      const dateStr = formatCycleDate(currentCycleEffectiveDate())
      const kv = createFakeStore({ parserVersion: 20, effectiveDate: dateStr, airportKeys: ['KSEA'] })
      __setKvStoreForTests(kv)
      fetchMock.mockImplementation(() => fetchFail()) // short-circuits before touching the Worker

      await getCifpData()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toMatch(/CIFP_/)
    })

    it('re-fetches when the stored cycle date is stale', async () => {
      const { __setKvStoreForTests, getCifpData } = await freshCifpCache()
      const kv = createFakeStore({ parserVersion: 21, effectiveDate: '2000-01-01', airportKeys: ['KSEA'] })
      __setKvStoreForTests(kv)
      fetchMock.mockImplementation(() => fetchFail())

      await getCifpData()

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('re-fetches when airportKeys is missing/empty even though version and date are fresh', async () => {
      const { __setKvStoreForTests, getCifpData } = await freshCifpCache()
      const dateStr = formatCycleDate(currentCycleEffectiveDate())
      const kv = createFakeStore({ parserVersion: 21, effectiveDate: dateStr, airportKeys: [] })
      __setKvStoreForTests(kv)
      fetchMock.mockImplementation(() => fetchFail())

      await getCifpData()

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('legacy monolithic blob', () => {
    it('is treated as stale (no parserVersion key present) and gets superseded by a fresh per-airport parse', async () => {
      const { __setKvStoreForTests, getCifpData } = await freshCifpCache()
      const kv = createFakeStore({ data: { KSEA: { legacy: true } } }) // pre-v21 shape, no meta keys
      __setKvStoreForTests(kv)
      fetchMock.mockImplementation(fetchOk)
      nextWorkerResult = { KSEA: FAKE_KSEA }

      await getCifpData()

      expect(await kv.get('data')).toBeUndefined()
      expect(await kv.get('airport:KSEA')).toEqual(FAKE_KSEA)
      expect(await kv.get('parserVersion')).toBe(21)
      expect(await kv.get('airportKeys')).toEqual(['KSEA'])
    })
  })

  describe('per-airport slice matches a direct parseCifp() call', () => {
    it('ensureAirport returns exactly the CifpAirportData a whole-file parse produces for that airport', async () => {
      // Real KAWO LOC RWY 34 fixture -- same lines as workers/__tests__/cifpParse.test.ts.
      const PA_KAWO =
        'SUSAP KAWOK1AAWO     0     053YHN48093870W122093250E017000142         1800018000C    MNAR    ARLINGTON MUNI                281361109'
      const mkLine = (overrides: Record<number, string>, length = 135): string => {
        const chars = new Array(length).fill(' ')
        for (const [startStr, text] of Object.entries(overrides)) {
          const start = Number(startStr)
          for (let i = 0; i < text.length; i++) chars[start + i] = text[i]
        }
        return chars.join('')
      }
      const PC_AW = mkLine({ 4: 'P', 12: 'C', 13: 'AW', 32: 'N47500000', 41: 'W122200000' })
      const PC_PAE = mkLine({ 4: 'P', 12: 'C', 13: 'PAE', 32: 'N47600000', 41: 'W122300000' })
      const PC_SAVOY = mkLine({ 4: 'P', 12: 'C', 13: 'SAVOY', 32: 'N48000000', 41: 'W122100000' })
      const PC_WATON = mkLine({ 4: 'P', 12: 'C', 13: 'WATON', 32: 'N48050000', 41: 'W122150000' })
      const PG_RW34 = mkLine({ 4: 'P', 12: 'G', 6: 'KAWO', 13: 'RW34', 32: 'N48070000', 41: 'W122160000' })
      const AAW_010_IF =
        'SUSAP KAWOK1FL34   AAW    010AW   K1PN0N       IF                                 - 06000     18000                 0 NS   281442203'
      const AAW_020_PI =
        'SUSAP KAWOK1FL34   AAW    020AW   K1PN0NE AL   PI IAWOK1      1621005720710100PI  + 02000                           0 NS   281451308'
      const APAE_010_IAF =
        'SUSAP KAWOK1FL34   APAE   010PAE  K1D 0V  A    FC PAE K1      0000000003660041D   + 02000     18000                 0 NS   281461308'
      const APAE_020_IF =
        'SUSAP KAWOK1FL34   APAE   020SAVOYK1PC0EE B    CF IAWOK1      1621011803660020PI  + 02000                           0 NS   281471310'
      const FINAL_010_FACF =
        'SUSAP KAWOK1FL34   L      010SAVOYK1PC0E  I    IF IAWOK1      16210118        PI  + 02000     18000                 0 NS   281481310'
      const FINAL_020_FAF =
        'SUSAP KAWOK1FL34   L      020WATONK1EA0E  F    CF IAWOK1      1621005734200060PI  + 01700                 AW    K1PN0 NS   281491308'
      const FINAL_030_MAP =
        'SUSAP KAWOK1FL34   L      030RW34 K1PG0GY M    CF IAWOK1      1621001034200047PI    00174             -305          0 NS   281501308'
      const FINAL_060_HM =
        'SUSAP KAWOK1FL34   L      060AW   K1PN0NE  L   HM                     3421T010    + 02000                           0 NS   281531308'
      const FIXTURE_TEXT = [
        PA_KAWO, PC_AW, PC_PAE, PC_SAVOY, PC_WATON, PG_RW34,
        AAW_010_IF, AAW_020_PI, APAE_010_IAF, APAE_020_IF,
        FINAL_010_FACF, FINAL_020_FAF, FINAL_030_MAP, FINAL_060_HM,
      ].join('\n')

      const result = parseCifp(FIXTURE_TEXT)
      expect(Object.keys(result)).toEqual(['KAWO'])

      const { __setKvStoreForTests, ensureAirport, useCifpStore } = await freshCifpCache()
      const kv = createFakeStore({
        parserVersion: 21,
        effectiveDate: formatCycleDate(currentCycleEffectiveDate()),
        airportKeys: Object.keys(result),
        'airport:KAWO': result.KAWO,
      })
      __setKvStoreForTests(kv)

      const warmed = await ensureAirport('KAWO')
      expect(warmed).toBe(true)
      expect(useCifpStore.getState().data.KAWO).toEqual(result.KAWO)
    })
  })

  describe('AIRAC rollover', () => {
    it('scheduleRollover fires a fresh parse at the next cycle boundary and persists the new layout', async () => {
      vi.useFakeTimers()
      const { __setKvStoreForTests, getCifpData, useCifpStore } = await freshCifpCache()
      const dateStr = formatCycleDate(currentCycleEffectiveDate())
      const kv = createFakeStore({
        parserVersion: 21,
        effectiveDate: dateStr,
        airportKeys: ['KSEA'],
        'airport:KSEA': FAKE_KSEA,
      })
      __setKvStoreForTests(kv)
      fetchMock.mockImplementation(fetchOk)

      await getCifpData() // cache hit -- schedules the rollover timer

      // Next cycle's parse result.
      nextWorkerResult = { KPAE: FAKE_KPAE }
      const msUntilNext = nextCycleDate().getTime() - Date.now()
      await vi.advanceTimersByTimeAsync(msUntilNext + 1000)

      expect(await kv.get('data')).toBeUndefined()
      expect(await kv.get('airport:KPAE')).toEqual(FAKE_KPAE)
      expect(await kv.get('airportKeys')).toEqual(['KPAE'])
      expect(useCifpStore.getState().status).toBe('ready')
    })

    it('does not refetch immediately when the next boundary is beyond the 32-bit setTimeout limit', async () => {
      // setTimeout clamps delays > 2^31-1 ms (~24.8 days) to fire at once, so
      // early in a 28-day cycle a naive setTimeout(nextCycle - now) loops
      // download→parse forever. Freeze time to just after a cycle boundary
      // (>24.8 days remaining) and prove the rollover stays quiet.
      vi.useFakeTimers()
      vi.setSystemTime(new Date(currentCycleEffectiveDate().getTime() + 60 * 60 * 1000))
      const { __setKvStoreForTests, getCifpData } = await freshCifpCache()
      const dateStr = formatCycleDate(currentCycleEffectiveDate())
      expect(nextCycleDate().getTime() - Date.now()).toBeGreaterThan(0x7fffffff)
      const kv = createFakeStore({
        parserVersion: 21,
        effectiveDate: dateStr,
        airportKeys: ['KSEA'],
        'airport:KSEA': FAKE_KSEA,
      })
      __setKvStoreForTests(kv)
      fetchMock.mockImplementation(fetchOk)

      await getCifpData() // cache hit -- arms the rollover timer

      // A day passes: with the old single setTimeout this had already fired
      // (clamped to 0) and refetched in a loop. Nothing should happen.
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
      expect(fetchMock).not.toHaveBeenCalled()

      // ...but the rollover must still fire once the boundary really arrives.
      nextWorkerResult = { KPAE: FAKE_KPAE }
      const msUntilNext = nextCycleDate().getTime() - Date.now()
      await vi.advanceTimersByTimeAsync(msUntilNext + 1000)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(await kv.get('airportKeys')).toEqual(['KPAE'])
    })
  })

  describe('setupVisibilityRefresh', () => {
    it('re-parses and persists the new layout when the tab becomes visible after the cycle went stale', async () => {
      const { __setKvStoreForTests, getCifpData, setupVisibilityRefresh, useCifpStore } = await freshCifpCache()
      const dateStr = formatCycleDate(currentCycleEffectiveDate())
      const kv = createFakeStore({
        parserVersion: 21,
        effectiveDate: dateStr,
        airportKeys: ['KSEA'],
        'airport:KSEA': FAKE_KSEA,
      })
      __setKvStoreForTests(kv)
      fetchMock.mockImplementation(fetchOk)
      await getCifpData() // cache hit, nothing warmed

      const teardown = setupVisibilityRefresh()
      try {
        // Simulate the AIRAC cycle going stale while the tab was backgrounded.
        useCifpStore.setState({ effectiveDate: '2000-01-01' })
        nextWorkerResult = { KPAE: FAKE_KPAE }

        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))

        await waitFor(async () => {
          expect(await kv.get('airport:KPAE')).toEqual(FAKE_KPAE)
        })
        expect(await kv.get('data')).toBeUndefined()
        expect(useCifpStore.getState().status).toBe('ready')
      } finally {
        teardown()
      }
    })

    it('does nothing when the tab becomes visible and the cycle is still fresh', async () => {
      const { __setKvStoreForTests, getCifpData, setupVisibilityRefresh } = await freshCifpCache()
      const dateStr = formatCycleDate(currentCycleEffectiveDate())
      const kv = createFakeStore({
        parserVersion: 21,
        effectiveDate: dateStr,
        airportKeys: ['KSEA'],
        'airport:KSEA': FAKE_KSEA,
      })
      __setKvStoreForTests(kv)
      await getCifpData()
      fetchMock.mockClear()

      const teardown = setupVisibilityRefresh()
      try {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
        // Give any (incorrectly triggered) async work a tick to start.
        await Promise.resolve()
        expect(fetchMock).not.toHaveBeenCalled()
      } finally {
        teardown()
      }
    })
  })
})
