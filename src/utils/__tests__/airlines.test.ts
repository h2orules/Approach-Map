import { describe, it, expect } from 'vitest'
import { decodeCallsign, airlineLogoUrl } from '../airlines'

describe('decodeCallsign', () => {
  it('decodes a known airline callsign into airline + flight number', () => {
    const d = decodeCallsign('UAL123')
    expect(d.airlineIcao).toBe('UAL')
    expect(d.airline?.name).toBe('United Airlines')
    expect(d.airline?.iata).toBe('UA')
    expect(d.flightNumber).toBe('123')
    expect(d.isTail).toBe(false)
  })

  it('handles alphanumeric flight suffixes', () => {
    const d = decodeCallsign('AAL1234')
    expect(d.airlineIcao).toBe('AAL')
    expect(d.flightNumber).toBe('1234')
  })

  it('decodes an unknown airline code but still splits the number', () => {
    const d = decodeCallsign('ZZZ99')
    expect(d.airlineIcao).toBe('ZZZ')
    expect(d.airline).toBeNull()
    expect(d.flightNumber).toBe('99')
  })

  it('flags N-number tail registrations', () => {
    const d = decodeCallsign('N123AB')
    expect(d.isTail).toBe(true)
    expect(d.airline).toBeNull()
    expect(d.flightNumber).toBeNull()
  })

  it('trims whitespace and is case-insensitive', () => {
    const d = decodeCallsign('  dal45  ')
    expect(d.airlineIcao).toBe('DAL')
    expect(d.flightNumber).toBe('45')
  })

  it('returns empty for blank input', () => {
    const d = decodeCallsign('')
    expect(d.airline).toBeNull()
    expect(d.airlineIcao).toBeNull()
    expect(d.isTail).toBe(false)
  })
})

describe('airlineLogoUrl', () => {
  it('builds an avs.io URL from the IATA code', () => {
    expect(airlineLogoUrl('UA')).toBe('https://pics.avs.io/120/40/UA.png')
  })
})
