import { describe, it, expect } from 'vitest'
import { parseDegMinSec, parseLatLon } from '../arincCoords'

describe('parseDegMinSec (hemisphere letter already stripped)', () => {
  it('parses 8-digit latitude DDMMSSSS', () => {
    // 47°23'52.17"
    expect(parseDegMinSec('47235217', false)).toBeCloseTo(47.397825, 5)
  })

  it('parses 9-digit longitude DDDMMSSSS', () => {
    // 122°18'41.62"
    expect(parseDegMinSec('122184162', true)).toBeCloseTo(-122.311561, 5)
  })

  it('returns 0 for empty input', () => {
    expect(parseDegMinSec('', false)).toBe(0)
  })

  it('returns 0 for wrong-length input', () => {
    expect(parseDegMinSec('1234', false)).toBe(0)
  })
})

describe('parseLatLon (full ARINC 424 fields with hemisphere letter)', () => {
  it('parses a Seattle-area terminal waypoint (KSEA OTLIE)', () => {
    const c = parseLatLon('N47235217', 'W122184162')
    expect(c).not.toBeNull()
    expect(c!.lat).toBeCloseTo(47.397825, 4)
    expect(c!.lon).toBeCloseTo(-122.311561, 4)
  })

  it('parses GRIFY (KSEA approach IAF) into the KSEA area, not [0,-12]', () => {
    // Regression: the old length checks (9/10) put this near the Gulf of Guinea
    const c = parseLatLon('N47460902', 'W122240743')
    expect(c).not.toBeNull()
    expect(c!.lat).toBeGreaterThan(46)
    expect(c!.lat).toBeLessThan(49)
    expect(c!.lon).toBeGreaterThan(-124)
    expect(c!.lon).toBeLessThan(-120)
  })

  it('honors southern and eastern hemispheres', () => {
    const c = parseLatLon('S33565600', 'E151102900')
    expect(c!.lat).toBeLessThan(0)
    expect(c!.lon).toBeGreaterThan(0)
  })

  it('returns null for blank fields', () => {
    expect(parseLatLon('', '')).toBeNull()
    expect(parseLatLon('   ', '   ')).toBeNull()
  })
})
