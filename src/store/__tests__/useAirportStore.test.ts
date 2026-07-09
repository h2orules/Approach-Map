import { describe, it, expect, beforeEach } from 'vitest'
import { useAirportStore, airportKey } from '../useAirportStore'
import { MAX_ACTIVE_AIRPORTS } from '../../config/constants'
import type { Airport, Runway } from '../../types/airport'
import type { AtisInfo } from '../../api/datis'

function atis(raw: string): AtisInfo {
  return { code: 'A', runwayPrefs: {}, depRunways: [], depRunwaysAdvisory: [], visualRunways: [], raw }
}

function airport(icao: string, key?: string): Airport {
  return { key, icao, iata: '', name: icao, lat: 1, lon: 2, elevation: 0, city: '', state: '' }
}

function runway(id: string): Runway {
  return {
    id,
    lengthFt: 9000,
    widthFt: 150,
    surfaceCode: '',
    lowEnd: { id: '16', heading: 160, lat: 1, lon: 2, displacedThresholdFt: 0 },
    highEnd: { id: '34', heading: 340, lat: 1.01, lon: 2, displacedThresholdFt: 0 },
  }
}

const store = () => useAirportStore.getState()

describe('useAirportStore', () => {
  beforeEach(() => {
    useAirportStore.setState({
      activeAirports: [],
      runwaysByIcao: {},
      atisByIcao: {},
      selectedAirport: null,
      runways: [],
      atisInfo: null,
      loading: false,
    })
  })

  describe('airportKey', () => {
    it('uses key when present, uppercased', () => {
      expect(airportKey(airport('ksea', 'ksea'))).toBe('KSEA')
    })
    it('falls back to icao when key is absent', () => {
      expect(airportKey(airport('KPAE'))).toBe('KPAE')
    })
  })

  describe('addAirport', () => {
    it('adds a new airport and returns "added"', () => {
      expect(store().addAirport(airport('KSEA'))).toBe('added')
      expect(store().activeAirports.map((a) => a.icao)).toEqual(['KSEA'])
    })

    it('is idempotent by key: adding the same airport again returns "exists"', () => {
      store().addAirport(airport('KSEA'))
      expect(store().addAirport(airport('KSEA'))).toBe('exists')
      expect(store().activeAirports).toHaveLength(1)
    })

    it('idempotency matches by key case-insensitively', () => {
      store().addAirport(airport('KSEA', 'KSEA'))
      expect(store().addAirport(airport('KSEA', 'ksea'))).toBe('exists')
    })

    it('returns "capped" once the hard cap is reached', () => {
      for (let i = 0; i < MAX_ACTIVE_AIRPORTS; i++) {
        expect(store().addAirport(airport(`K${i.toString().padStart(3, '0')}`))).toBe('added')
      }
      expect(store().activeAirports).toHaveLength(MAX_ACTIVE_AIRPORTS)
      expect(store().addAirport(airport('KOVER'))).toBe('capped')
      expect(store().activeAirports).toHaveLength(MAX_ACTIVE_AIRPORTS)
    })

    it('first added airport becomes primary (selectedAirport mirror)', () => {
      store().addAirport(airport('KSEA'))
      store().addAirport(airport('KPAE'))
      expect(store().selectedAirport?.icao).toBe('KSEA')
    })
  })

  describe('removeAirport', () => {
    it('removes the airport and prunes its runwaysByIcao/atisByIcao entries', () => {
      store().addAirport(airport('KSEA'))
      store().setRunwaysForAirport('KSEA', [runway('16/34')])
      store().setAtisForAirport('KSEA', atis('INFO A'))

      store().removeAirport('KSEA')

      expect(store().activeAirports).toEqual([])
      expect(store().runwaysByIcao.KSEA).toBeUndefined()
      expect(store().atisByIcao.KSEA).toBeUndefined()
      expect(store().runways).toEqual([])
      expect(store().atisInfo).toBeNull()
    })

    it('is a no-op when the key is not active', () => {
      store().addAirport(airport('KSEA'))
      const before = store().activeAirports
      store().removeAirport('KPAE')
      expect(store().activeAirports).toBe(before)
    })

    it('promotes the next airport to primary when the primary is removed', () => {
      store().addAirport(airport('KSEA'))
      store().addAirport(airport('KPAE'))
      store().removeAirport('KSEA')
      expect(store().selectedAirport?.icao).toBe('KPAE')
    })
  })

  describe('runways mirror', () => {
    it('flattens runways across ALL active airports', () => {
      store().addAirport(airport('KSEA'))
      store().addAirport(airport('KPAE'))
      store().setRunwaysForAirport('KSEA', [runway('16/34')])
      store().setRunwaysForAirport('KPAE', [runway('16/34'), runway('11/29')])
      expect(store().runways).toHaveLength(3)
    })
  })

  describe('atisInfo mirror', () => {
    it('reflects only the primary airport', () => {
      store().addAirport(airport('KSEA'))
      store().addAirport(airport('KPAE'))
      store().setAtisForAirport('KPAE', atis('PAE INFO'))
      expect(store().atisInfo).toBeNull()
      store().setAtisForAirport('KSEA', atis('SEA INFO'))
      expect(store().atisInfo?.raw).toBe('SEA INFO')
    })
  })

  describe('setSelectedAirport / setActiveAirports', () => {
    it('setSelectedAirport(a) replaces the whole active list with [a]', () => {
      store().addAirport(airport('KSEA'))
      store().addAirport(airport('KPAE'))
      store().setSelectedAirport(airport('KJFK'))
      expect(store().activeAirports.map((a) => a.icao)).toEqual(['KJFK'])
    })

    it('setSelectedAirport(null) clears the active list', () => {
      store().addAirport(airport('KSEA'))
      store().setSelectedAirport(null)
      expect(store().activeAirports).toEqual([])
      expect(store().selectedAirport).toBeNull()
    })

    it('setActiveAirports replaces the list wholesale and recomputes mirrors', () => {
      store().setRunwaysForAirport('KSEA', [runway('16/34')])
      store().setActiveAirports([airport('KSEA')])
      expect(store().activeAirports).toHaveLength(1)
      expect(store().runways).toHaveLength(1)
    })
  })

  describe('persistence migrate/merge', () => {
    it('migrates a v0 single-{selectedAirport} payload into a one-element activeAirports list', () => {
      const options = useAirportStore.persist.getOptions()
      const migrated = options.migrate?.({ selectedAirport: airport('KSEA') }, 0)
      expect(migrated).toEqual({ activeAirports: [airport('KSEA')] })
    })

    it('migrates a v0 payload with a null selectedAirport into an empty list', () => {
      const options = useAirportStore.persist.getOptions()
      const migrated = options.migrate?.({ selectedAirport: null }, 0)
      expect(migrated).toEqual({ activeAirports: [] })
    })

    it('passes a v1 payload through unchanged', () => {
      const options = useAirportStore.persist.getOptions()
      const payload = { activeAirports: [airport('KSEA'), airport('KPAE')] }
      const migrated = options.migrate?.(payload, 1)
      expect(migrated).toEqual(payload)
    })

    it('merge recomputes the derived mirrors from the rehydrated activeAirports', () => {
      const options = useAirportStore.persist.getOptions()
      const current = useAirportStore.getState()
      const merged = options.merge?.({ activeAirports: [airport('KSEA')] }, current)
      expect(merged?.activeAirports.map((a) => a.icao)).toEqual(['KSEA'])
      expect(merged?.selectedAirport?.icao).toBe('KSEA')
    })

    it('merge defaults to an empty active list when the persisted payload is missing it', () => {
      const options = useAirportStore.persist.getOptions()
      const current = useAirportStore.getState()
      const merged = options.merge?.(undefined, current)
      expect(merged?.activeAirports).toEqual([])
      expect(merged?.selectedAirport).toBeNull()
    })

    it('only persists activeAirports (partialize)', () => {
      const options = useAirportStore.persist.getOptions()
      store().addAirport(airport('KSEA'))
      store().setRunwaysForAirport('KSEA', [runway('16/34')])
      const partial = options.partialize?.(useAirportStore.getState())
      expect(Object.keys(partial ?? {})).toEqual(['activeAirports'])
    })
  })
})
