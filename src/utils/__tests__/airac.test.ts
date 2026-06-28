import { describe, it, expect } from 'vitest'
import { currentCycleEffectiveDate, nextCycleDate, isCycleStale, cifpUrl } from '../airac'

describe('AIRAC cycle utilities', () => {
  it('returns the reference date itself when now equals the reference', () => {
    const ref = new Date('2024-01-25T00:00:00Z')
    const result = currentCycleEffectiveDate(ref)
    expect(result.toISOString()).toBe(ref.toISOString())
  })

  it('returns the reference date when just before the next cycle', () => {
    // Next cycle after 2024-01-25 is 2024-02-22; one second before it
    const justBefore = new Date('2024-02-21T23:59:59Z')
    const result = currentCycleEffectiveDate(justBefore)
    expect(result.toISOString()).toBe('2024-01-25T00:00:00.000Z')
  })

  it('advances to next cycle at 28-day mark', () => {
    const nextCycleStart = new Date('2024-02-22T00:00:00Z') // exactly 28 days after 2024-01-25
    const result = currentCycleEffectiveDate(nextCycleStart)
    expect(result.toISOString()).toBe('2024-02-22T00:00:00.000Z')
  })

  it('nextCycleDate is 28 days after current', () => {
    const now = new Date('2024-01-27T12:00:00Z') // inside the 2024-01-25 cycle
    const next = nextCycleDate(now)
    const expected = new Date('2024-02-22T00:00:00Z')
    expect(next.toISOString()).toBe(expected.toISOString())
  })

  it('isCycleStale returns true for null', () => {
    expect(isCycleStale(null)).toBe(true)
  })

  it('isCycleStale returns false when stored date matches current cycle', () => {
    const now = new Date('2024-01-27T12:00:00Z')
    const currentDate = currentCycleEffectiveDate(now)
    expect(isCycleStale(currentDate.toISOString(), now)).toBe(false)
  })

  it('isCycleStale returns true when stored date is from a previous cycle', () => {
    const now = new Date('2024-02-25T12:00:00Z') // in the 2024-02-22 cycle
    const oldDate = '2024-01-25T00:00:00.000Z'   // previous cycle
    expect(isCycleStale(oldDate, now)).toBe(true)
  })

  it('cifpUrl encodes the date in YYMMDD format', () => {
    const date = new Date('2024-01-25T00:00:00Z')
    expect(cifpUrl(date)).toBe('/api/faa-cifp/CIFP_240125.zip')
  })

  it('cifpUrl generates the correct current cycle URL', () => {
    // June 11 2026 is the active AIRAC cycle as of June 2026
    const date = new Date('2026-06-11T00:00:00Z')
    expect(cifpUrl(date)).toBe('/api/faa-cifp/CIFP_260611.zip')
  })
})
