import { describe, it, expect } from 'vitest'
import { bearingDelta, matchPointToLine, segmentFraction } from '../lineMatching'

// A northbound meridian near the equator (bearing 0), where 1° ≈ 60 nm.
const line: [number, number][] = [
  [0, 0],
  [0, 1],
]

const OPTS = { maxCrossTrackNm: 2, directionToleranceDeg: 45 }

describe('bearingDelta', () => {
  it('is symmetric and wraps', () => {
    expect(bearingDelta(10, 350)).toBeCloseTo(20)
    expect(bearingDelta(350, 10)).toBeCloseTo(20)
    expect(bearingDelta(0, 180)).toBeCloseTo(180)
  })
})

describe('matchPointToLine', () => {
  it('matches an on-line aircraft flying the line direction', () => {
    const m = matchPointToLine(line, 0.5, 0, 0, OPTS)
    expect(m).not.toBeNull()
    expect(m!.segIdx).toBe(0)
    expect(m!.crossTrackNm).toBeCloseTo(0, 2)
  })

  it('rejects an aircraft just over the cross-track threshold', () => {
    // 0.05° east ≈ 3 nm, past the 2 nm gate.
    expect(matchPointToLine(line, 0.5, 0.05, 0, OPTS)).toBeNull()
  })

  it('rejects the reciprocal direction', () => {
    expect(matchPointToLine(line, 0.5, 0, 180, OPTS)).toBeNull()
  })

  it('accepts 44° track difference at a 45° tolerance', () => {
    const m = matchPointToLine(line, 0.5, 0, 44, OPTS)
    expect(m).not.toBeNull()
  })

  it('does not throw and skips the direction gate on a zero-length segment', () => {
    const degenerate: [number, number][] = [
      [0, 0],
      [0, 0],
      [0, 1],
    ]
    // Track 200 would fail the direction gate on a real segment; the zero-length
    // first segment has no bearing, so the match is returned regardless.
    const m = matchPointToLine(degenerate, 0, 0, 200, OPTS)
    expect(m).not.toBeNull()
    expect(m!.segIdx).toBe(0)
  })
})

describe('segmentFraction', () => {
  it('returns 0.5 at the segment midpoint', () => {
    expect(segmentFraction([0, 0], [0, 1], [0, 0.5])).toBeCloseTo(0.5, 3)
  })

  it('clamps to [0, 1] and handles zero-length segments', () => {
    expect(segmentFraction([0, 0], [0, 0], [0, 0])).toBe(0)
    expect(segmentFraction([0, 0], [0, 1], [0, 2])).toBe(1)
  })
})
