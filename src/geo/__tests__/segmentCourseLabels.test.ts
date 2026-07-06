import { describe, it, expect } from 'vitest'
import {
  bearingDelta,
  padCourse,
  groupCourseLabels,
  labelRotation,
  type CourseLeg,
} from '../segmentCourseLabels'

const leg = (lat: number, lon: number, course = 0, pathTerm = 'TF', role = 'normal'): CourseLeg => ({
  lat,
  lon,
  course,
  pathTerm,
  role,
})

describe('padCourse', () => {
  it('zero-pads to three digits and maps 0 → 360', () => {
    expect(padCourse(5)).toBe('005')
    expect(padCourse(42)).toBe('042')
    expect(padCourse(342)).toBe('342')
    expect(padCourse(360)).toBe('360')
    expect(padCourse(0)).toBe('360')
    expect(padCourse(365)).toBe('005')
  })
})

describe('bearingDelta', () => {
  it('returns the smallest wrap-around difference', () => {
    expect(bearingDelta(350, 10)).toBe(20)
    expect(bearingDelta(10, 350)).toBe(20)
    expect(bearingDelta(90, 90)).toBe(0)
  })
})

describe('groupCourseLabels', () => {
  it('emits one label for a straight run and prefers the ARINC course', () => {
    // Two collinear ~due-north segments, ARINC course 342 on the destination legs.
    const legs = [
      leg(47.0, -122.3),
      leg(47.05, -122.3, 342),
      leg(47.1, -122.3, 342),
    ]
    const labels = groupCourseLabels(legs, 17, false)
    expect(labels).toHaveLength(1)
    expect(labels[0].text).toBe('342')
    expect(labels[0].noPt).toBe(false)
  })

  it('falls back to geodetic bearing minus magvar when ARINC course is absent', () => {
    const labels = groupCourseLabels([leg(47.0, -122.3), leg(47.1, -122.3)], 17, false)
    // Geodetic bearing ~0° (north); mag = 0 - 17 = -17 → 343°.
    expect(labels).toHaveLength(1)
    expect(labels[0].text).toBe('343')
  })

  it('splits into separate groups when the bearing turns beyond tolerance', () => {
    const labels = groupCourseLabels(
      [leg(47.0, -122.3), leg(47.1, -122.3), leg(47.1, -122.1)],
      0,
      false,
    )
    expect(labels).toHaveLength(2)
  })

  it('stops at the missed-approach point and skips course-reversal/hold legs', () => {
    const labels = groupCourseLabels(
      [
        leg(47.0, -122.3),
        leg(47.1, -122.3, 342, 'PI'), // course reversal — skipped as a vertex
        leg(47.2, -122.3, 342, 'TF', 'map'), // MAP — labeled up to here, then stop
        leg(47.3, -122.3, 342), // missed approach — excluded
      ],
      0,
      false,
    )
    // Only the segment(s) up to the MAP, PI leg excluded → single straight run.
    expect(labels).toHaveLength(1)
    expect(labels[0].text).toBe('342')
  })

  it('propagates the NoPT flag', () => {
    const labels = groupCourseLabels([leg(47.0, -122.3), leg(47.1, -122.3, 37)], 0, true)
    expect(labels[0].noPt).toBe(true)
  })
})

describe('labelRotation', () => {
  it('keeps an east-west leg horizontal', () => {
    expect(labelRotation(90, 0)).toEqual({ rot: 0, flipped: false })
  })

  it('flips a westbound leg so text stays upright', () => {
    const { rot, flipped } = labelRotation(270, 0)
    expect(flipped).toBe(true)
    expect(rot).toBeCloseTo(0, 6)
  })

  it('never leaves rotation outside the readable ±90° band', () => {
    for (let b = 0; b < 360; b += 15) {
      const { rot } = labelRotation(b, 37)
      expect(Math.abs(rot)).toBeLessThanOrEqual(90 + 1e-9)
    }
  })
})
