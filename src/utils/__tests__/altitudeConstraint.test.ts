import { describe, it, expect } from 'vitest'
import { parseAltConstraint, resolveAltConstraint, parseArinc424AltDescriptor } from '../altitudeConstraint'

describe('parseAltConstraint', () => {
  it('parses AT OR ABOVE', () => {
    const result = parseAltConstraint('AT OR ABOVE 3000')
    expect(result).toEqual({ type: 'AT_OR_ABOVE', low: 3000 })
  })

  it('parses AT OR BELOW', () => {
    const result = parseAltConstraint('AT OR BELOW 5000')
    expect(result).toEqual({ type: 'AT_OR_BELOW', low: 5000, high: 5000 })
  })

  it('parses plain altitude', () => {
    const result = parseAltConstraint('4000')
    expect(result).toEqual({ type: 'AT', low: 4000 })
  })

  it('parses range', () => {
    const result = parseAltConstraint('2000-4000')
    expect(result).toEqual({ type: 'BETWEEN', low: 2000, high: 4000 })
  })

  it('returns null for empty input', () => {
    expect(parseAltConstraint(null)).toBeNull()
    expect(parseAltConstraint('')).toBeNull()
  })
})

describe('resolveAltConstraint', () => {
  it('resolves AT to its value', () => {
    expect(resolveAltConstraint({ type: 'AT', low: 5000 })).toBe(5000)
  })

  it('resolves AT_OR_ABOVE to floor', () => {
    expect(resolveAltConstraint({ type: 'AT_OR_ABOVE', low: 3000 })).toBe(3000)
  })

  it('resolves AT_OR_BELOW to ceiling', () => {
    expect(resolveAltConstraint({ type: 'AT_OR_BELOW', low: 5000, high: 5000 })).toBe(5000)
  })

  it('resolves BETWEEN to midpoint', () => {
    expect(resolveAltConstraint({ type: 'BETWEEN', low: 2000, high: 4000 })).toBe(3000)
  })

  it('returns null for null input', () => {
    expect(resolveAltConstraint(null)).toBeNull()
  })
})

describe('parseArinc424AltDescriptor', () => {
  it('parses @ (AT) descriptor', () => {
    // alt1 = "0300" means 300 * 10 = 3000ft
    expect(parseArinc424AltDescriptor('@', '0300', '     ')).toEqual({ type: 'AT', low: 3000 })
  })

  it('parses + (AT OR ABOVE) descriptor', () => {
    expect(parseArinc424AltDescriptor('+', '0500', '     ')).toEqual({ type: 'AT_OR_ABOVE', low: 5000 })
  })

  it('parses - (AT OR BELOW) descriptor', () => {
    expect(parseArinc424AltDescriptor('-', '0800', '     ')).toEqual({ type: 'AT_OR_BELOW', low: 8000, high: 8000 })
  })

  it('parses B (BETWEEN) descriptor', () => {
    expect(parseArinc424AltDescriptor('B', '0300', '0500')).toEqual({ type: 'BETWEEN', low: 3000, high: 5000 })
  })

  it('returns null when no valid altitude', () => {
    expect(parseArinc424AltDescriptor(' ', '     ', '     ')).toBeNull()
  })
})
