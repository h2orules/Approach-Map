import { describe, it, expect } from 'vitest'
import { holdTrack, procedureTurn } from '../procedureShapes'

const finite = (pts: [number, number][]) =>
  pts.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))

describe('holdTrack', () => {
  it('returns a closed racetrack of finite coords near the fix', () => {
    const fixLat = 47.6476
    const fixLon = -122.3094
    const track = holdTrack(fixLat, fixLon, 161, true, 4)
    expect(track.length).toBeGreaterThan(6)
    expect(finite(track)).toBe(true)
    // start and end coincide (closed loop)
    expect(track[0][0]).toBeCloseTo(track[track.length - 1][0], 6)
    expect(track[0][1]).toBeCloseTo(track[track.length - 1][1], 6)
    // stays within a few nm of the fix (~0.2° lat)
    for (const [lon, lat] of track) {
      expect(Math.abs(lat - fixLat)).toBeLessThan(0.3)
      expect(Math.abs(lon - fixLon)).toBeLessThan(0.3)
    }
  })

  it('mirrors the pattern for left vs right turns', () => {
    const r = holdTrack(40, -100, 90, true, 3)
    const l = holdTrack(40, -100, 90, false, 3)
    expect(finite(r)).toBe(true)
    expect(finite(l)).toBe(true)
    // opposite turn directions place the outbound leg on opposite sides
    expect(Math.sign(r[3][1] - 40)).not.toBe(Math.sign(l[3][1] - 40))
  })
})

describe('procedureTurn', () => {
  it('returns a finite barb anchored at the fix', () => {
    const pts = procedureTurn(40, -100, 270, true, 4)
    expect(pts.length).toBeGreaterThanOrEqual(4)
    expect(finite(pts)).toBe(true)
    expect(pts[0]).toEqual([-100, 40])
  })
})
