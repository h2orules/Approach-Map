import { describe, it, expect } from 'vitest'
import { deadReckon } from '../interpolation'

describe('deadReckon', () => {
  it('returns same position for zero speed', () => {
    const result = deadReckon(47.45, -122.31, 270, 0, 5000)
    expect(result).toEqual({ lat: 47.45, lon: -122.31 })
  })

  it('returns same position for zero elapsed time', () => {
    const result = deadReckon(47.45, -122.31, 270, 250, 0)
    expect(result).toEqual({ lat: 47.45, lon: -122.31 })
  })

  it('moves westward for track 270', () => {
    // 300kt for 1 minute = 5nm westward
    const result = deadReckon(47.45, -122.31, 270, 300, 60_000)
    expect(result.lat).toBeCloseTo(47.45, 1)
    expect(result.lon).toBeLessThan(-122.31)
  })

  it('moves northward for track 0', () => {
    const result = deadReckon(47.45, -122.31, 0, 300, 60_000)
    expect(result.lat).toBeGreaterThan(47.45)
    expect(result.lon).toBeCloseTo(-122.31, 1)
  })

  it('5nm at 300kt for 1 min', () => {
    // At 300kt: 300/60 = 5nm per minute
    const result = deadReckon(0, 0, 90, 300, 60_000)
    expect(result.lat).toBeCloseTo(0, 2)
    // eastward: lon should increase by approximately 5nm in degrees at equator
    // 1nm = ~0.01667 degrees at equator
    expect(result.lon).toBeCloseTo(5 * (1 / 60), 1)
  })
})
