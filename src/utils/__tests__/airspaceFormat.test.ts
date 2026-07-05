import { describe, it, expect } from 'vitest'
import { airspaceStyleFor, altHundreds, airspaceAltLabel, NO_CEILING } from '../airspaceFormat'
import type { AirspaceSector } from '../../types/airspace'

function sector(overrides: Partial<AirspaceSector>): AirspaceSector {
  return {
    name: 'TEST',
    airspaceClass: 'B',
    localType: 'CLASS_B',
    style: 'B',
    lowerVal: 0,
    lowerCode: 'SFC',
    upperVal: 10000,
    upperCode: 'MSL',
    geometry: { type: 'Polygon', coordinates: [] },
    ...overrides,
  }
}

describe('airspaceStyleFor', () => {
  it('maps B/C/D directly', () => {
    expect(airspaceStyleFor('B', 5000)).toBe('B')
    expect(airspaceStyleFor('C', 0)).toBe('C')
    expect(airspaceStyleFor('D', 0)).toBe('D')
  })

  it('splits Class E into surface vs transition by floor', () => {
    expect(airspaceStyleFor('E', 0)).toBe('E_SFC') // CLASS_E2 surface area
    expect(airspaceStyleFor('E', 700)).toBe('E_TRANS') // 700ft AGL transition
    expect(airspaceStyleFor('E', 1200)).toBe('E_TRANS')
  })
})

describe('altHundreds', () => {
  it('renders hundreds of feet', () => {
    expect(altHundreds(10000, 'MSL')).toBe('100')
    expect(altHundreds(2500, 'MSL')).toBe('25')
    expect(altHundreds(1800, 'MSL')).toBe('18')
  })

  it('spells out the surface', () => {
    expect(altHundreds(0, 'SFC')).toBe('SFC')
    expect(altHundreds(0, 'MSL')).toBe('SFC')
  })

  it('passes flight levels through', () => {
    expect(altHundreds(180, 'FL')).toBe('FL180')
  })
})

describe('airspaceAltLabel', () => {
  it('gives Class B a ceiling-over-floor fraction', () => {
    expect(airspaceAltLabel(sector({ airspaceClass: 'B', upperVal: 10000, lowerVal: 5000, lowerCode: 'MSL' })))
      .toEqual({ ceiling: '100', floor: '50' })
  })

  it('shows SFC for a surface-based Class B shelf', () => {
    expect(airspaceAltLabel(sector({ airspaceClass: 'B', upperVal: 10000, lowerVal: 0, lowerCode: 'SFC' })))
      .toEqual({ ceiling: '100', floor: 'SFC' })
  })

  it('gives Class D a ceiling only', () => {
    expect(airspaceAltLabel(sector({ airspaceClass: 'D', upperVal: 2500, lowerVal: 0 })))
      .toEqual({ ceiling: '25', floor: null })
  })

  it('returns null for Class E and for uncharted ceilings', () => {
    expect(airspaceAltLabel(sector({ airspaceClass: 'E', upperVal: NO_CEILING }))).toBeNull()
    expect(airspaceAltLabel(sector({ airspaceClass: 'D', upperVal: NO_CEILING }))).toBeNull()
  })
})
