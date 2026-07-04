import { describe, it, expect } from 'vitest'
import { appendSamples, averageCount, type DetectionSample } from '../detectionHistory'

describe('appendSamples', () => {
  it('appends a new sample per counted id and prunes samples outside the window', () => {
    const windowMs = 1000
    const now = 5000
    const history: Record<string, DetectionSample[]> = {
      A: [{ t: 4500, count: 2 }],
    }
    const result = appendSamples(history, { A: 3 }, now, windowMs)
    expect(result.A).toEqual([
      { t: 4500, count: 2 },
      { t: 5000, count: 3 },
    ])
  })

  it('drops a sample exactly at the window boundary (nowMs - windowMs)', () => {
    const windowMs = 1000
    const now = 5000
    const cutoff = now - windowMs // 4000
    const history: Record<string, DetectionSample[]> = {
      A: [{ t: cutoff, count: 9 }, { t: cutoff + 1, count: 5 }],
    }
    const result = appendSamples(history, {}, now, windowMs)
    // sample exactly at cutoff is dropped; the one 1ms inside survives
    expect(result.A).toEqual([{ t: cutoff + 1, count: 5 }])
  })

  it('counts zeros as real samples (not treated as absent)', () => {
    const result = appendSamples({}, { A: 0 }, 1000, 1000)
    expect(result.A).toEqual([{ t: 1000, count: 0 }])
    expect(averageCount(result.A, 1000, 1000)).toBe(0)
  })

  it('drops an id once its samples age out of the window and no new count arrives', () => {
    const windowMs = 1000
    const history: Record<string, DetectionSample[]> = {
      A: [{ t: 100, count: 1 }],
    }
    // now far beyond the window, and A is not in this poll's counts
    const result = appendSamples(history, {}, 5000, windowMs)
    expect(result.A).toBeUndefined()
    expect('A' in result).toBe(false)
  })

  it('does not mutate the input history object or its arrays', () => {
    const originalSamples: DetectionSample[] = [{ t: 100, count: 1 }]
    const history: Record<string, DetectionSample[]> = { A: originalSamples }
    const historySnapshot = JSON.parse(JSON.stringify(history))

    appendSamples(history, { A: 5, B: 1 }, 200, 1000)

    expect(history).toEqual(historySnapshot)
    expect(history.A).toBe(originalSamples) // same array reference, untouched
    expect(originalSamples).toEqual([{ t: 100, count: 1 }])
  })

  it('returns a plain empty object when given no history and no counts', () => {
    expect(appendSamples({}, {}, 0, 1000)).toEqual({})
  })
})

describe('averageCount', () => {
  it('returns 0 for undefined samples', () => {
    expect(averageCount(undefined, 1000, 1000)).toBe(0)
  })

  it('returns 0 for an empty samples array', () => {
    expect(averageCount([], 1000, 1000)).toBe(0)
  })

  it('averages only the in-window samples, including zero counts', () => {
    const windowMs = 1000
    const now = 5000
    const samples: DetectionSample[] = [
      { t: 3000, count: 10 }, // outside window (before cutoff 4000)
      { t: 4500, count: 0 },
      { t: 4800, count: 2 },
      { t: 5000, count: 4 },
    ]
    // in-window: 0, 2, 4 → mean 2
    expect(averageCount(samples, now, windowMs)).toBe(2)
  })
})
