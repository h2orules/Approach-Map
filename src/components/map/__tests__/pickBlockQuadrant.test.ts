import { describe, it, expect } from 'vitest'
import { pickBlockQuadrant } from '../DataBlock'

describe('pickBlockQuadrant', () => {
  it('picks the diagonal farthest from both the projected path ahead and the trail direction', () => {
    // Heading due north (0) with a trail bearing due east (90, e.g. mid-turn) —
    // the SW diagonal (225) is the only one far from both.
    expect(pickBlockQuadrant(0, 90, null)).toBe(225)
  })

  it('picks a perpendicular diagonal for straight-line flight, never the fore/aft ones', () => {
    // Track 015 with no incumbent: the trail direction for genuinely straight
    // flight is the reciprocal of track (195, per the <2-track-point
    // fallback), so the 45/225 diagonals (nearly astride the flight line) lose
    // to the 135/315 diagonals (perpendicular to it).
    const quadrant = pickBlockQuadrant(15, 195, null)
    expect([135, 315]).toContain(quadrant)
  })

  it('resolves ties to the first quadrant in NE, SE, SW, NW order', () => {
    // Due-north path / due-south trail scores all four diagonals equally (45°
    // each) — the tie must resolve deterministically rather than flapping.
    expect(pickBlockQuadrant(0, 180, null)).toBe(45)
  })

  it('keeps the incumbent quadrant while its score stays at/above the hysteresis floor', () => {
    // Same tied geometry as above (every quadrant scores 45°, comfortably
    // over the 30° floor) — a prior selection of 315 must not flap to the
    // tie-break winner (45) just because 45 is what a fresh pick would choose.
    expect(pickBlockQuadrant(0, 180, 315)).toBe(315)
  })

  it('keeps the incumbent exactly at the 30° floor (switch requires a strictly lower score)', () => {
    // Track 015 / reciprocal trail scores the NE diagonal (45) at exactly 30°
    // and the perpendicular diagonals at 60° — a 30-point margin that would
    // clear the 20° hysteresis margin, but the switch condition requires the
    // incumbent's own score to drop *below* 30, not just be beaten.
    expect(pickBlockQuadrant(15, 195, 45)).toBe(45)
  })

  it('switches once the incumbent score drops below the 30° floor', () => {
    // Nudging the same geometry so the incumbent's score is 29 (just under
    // the floor) with a 32° margin to the best alternative (225) — both
    // hysteresis conditions are now met, so it switches.
    expect(pickBlockQuadrant(16, 164, 45)).toBe(225)
  })
})
