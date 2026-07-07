import { describe, it, expect } from 'vitest'
import { decideFlyTarget } from '../decideFlyTarget'
import type { Airport } from '../../types/airport'

function airport(icao: string, lat: number, lon: number, key?: string): Airport {
  return { key, icao, iata: '', name: icao, lat, lon, elevation: 0, city: '', state: '' }
}

describe('decideFlyTarget', () => {
  it('flies to the first airport (empty current list)', () => {
    const target = decideFlyTarget([], airport('KSEA', 47.45, -122.31))
    expect(target).toEqual({ lat: 47.45, lon: -122.31, zoom: 11 })
  })

  it('returns null when adding a 2nd+ airport (camera stays on the primary)', () => {
    const target = decideFlyTarget([airport('KSEA', 47.45, -122.31)], airport('KPAE', 47.9, -122.28))
    expect(target).toBeNull()
  })

  it('flies when re-selecting the current primary airport', () => {
    const primary = airport('KSEA', 47.45, -122.31)
    const target = decideFlyTarget([primary, airport('KPAE', 47.9, -122.28)], airport('KSEA', 47.45, -122.31))
    expect(target).toEqual({ lat: 47.45, lon: -122.31, zoom: 11 })
  })

  it('does not fly when re-selecting a non-primary airport already in the list', () => {
    const target = decideFlyTarget(
      [airport('KSEA', 47.45, -122.31), airport('KPAE', 47.9, -122.28)],
      airport('KPAE', 47.9, -122.28),
    )
    expect(target).toBeNull()
  })

  it('matches primary by key when key differs from icao casing/identity', () => {
    const primary = airport('A09', 1, 2, 'A09')
    const target = decideFlyTarget([primary], airport('A09', 1, 2, 'A09'))
    expect(target).toEqual({ lat: 1, lon: 2, zoom: 11 })
  })
})
