import { describe, it, expect } from 'vitest'
import { dtppCycle } from '../dtppCycle'

describe('dtppCycle', () => {
  it('the AIRAC reference cycle (2024-01-25) is the first 2024 cycle', () => {
    expect(dtppCycle(new Date('2024-01-25T00:00:00Z'))).toBe('2401')
  })

  it('28 days later is the second 2024 cycle', () => {
    expect(dtppCycle(new Date('2024-02-22T00:00:00Z'))).toBe('2402')
  })

  it('the last 2024 cycle (2024-12-26) is ordinal 13', () => {
    // 2024-01-25 -> 2024-12-26 is 11 full 28-day steps after the reference
    // cycle (n=12), and no cycle boundary between 2024-01-25 and 2024-12-26
    // crosses into a different calendar year, so ordinal = 13.
    expect(dtppCycle(new Date('2024-12-26T00:00:00Z'))).toBe('2413')
  })

  it('the first 2025 cycle (2025-01-23) resets the ordinal to 1', () => {
    expect(dtppCycle(new Date('2025-01-23T00:00:00Z'))).toBe('2501')
  })

  it('2026-06-11 (current cycle per CLAUDE.md) is the 6th 2026 cycle', () => {
    // Elapsed since the 2024-01-25 reference: 366 (2024, leap) + 365 (2025)
    // + 137 (2026-01-01 .. 2026-06-11) = 868 days = exactly 31 * 28, so this
    // is cycle index n=31 with zero remainder. The first 2026 cycle is
    // n=26 (2026-01-22), so ordinal = 31 - 26 + 1 = 6 -> "2606".
    expect(dtppCycle(new Date('2026-06-11T00:00:00Z'))).toBe('2606')
  })

  it('a January date can still belong to the previous year\'s last cycle', () => {
    // 2025-01-03 falls inside the cycle effective 2024-12-26 (the next cycle
    // doesn't start until 2025-01-23), so per our convention the returned
    // cycle number reflects the *cycle's* effective date/year (2024, ordinal
    // 13), not the calendar year of the queried date (2025).
    expect(dtppCycle(new Date('2025-01-03T00:00:00Z'))).toBe('2413')
  })
})
