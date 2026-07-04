import { describe, it, expect } from 'vitest'
import * as turf from '@turf/turf'
import {
  sectorPolygon,
  sectorBoundaryLines,
  sectorLabelAnchor,
  chooseSafeAltitudeArea,
} from '../safeAltitude'
import type { SafeAltitudeArea, SafeAltitudeSector } from '../../types/safeAltitude'

const CENTER_LAT = 0
const CENTER_LON = 0

function sector(overrides: Partial<SafeAltitudeSector> = {}): SafeAltitudeSector {
  return {
    fromBrgTrue: 0,
    toBrgTrue: 90,
    innerNm: 0,
    outerNm: 20,
    altitudeFt: 6000,
    ...overrides,
  }
}

describe('sectorPolygon', () => {
  it('closes a pie-slice polygon (innerNm === 0) at the center point, with the expected vertex count', () => {
    const s = sector({ fromBrgTrue: 0, toBrgTrue: 90, innerNm: 0, outerNm: 20 })
    const stepDeg = 10 // sweep 90 / step 10 = 9 steps -> 10 arc points
    const ring = sectorPolygon(CENTER_LAT, CENTER_LON, s, stepDeg)

    // [center, ...arc(10 pts), center]
    expect(ring.length).toBe(12)
    expect(ring[0]).toEqual([CENTER_LON, CENTER_LAT])
    expect(ring[ring.length - 1]).toEqual([CENTER_LON, CENTER_LAT])
  })

  it('builds an annulus ring (innerNm > 0) whose outer/inner arc points sit at the right radii', () => {
    const s = sector({ fromBrgTrue: 0, toBrgTrue: 90, innerNm: 5, outerNm: 20 })
    const stepDeg = 10
    const ring = sectorPolygon(CENTER_LAT, CENTER_LON, s, stepDeg)

    // outerArc(10) + innerArc reversed(10) + closing point = 21
    expect(ring.length).toBe(21)
    expect(ring[0]).toEqual(ring[ring.length - 1]) // closed

    const center = turf.point([CENTER_LON, CENTER_LAT])
    // first 10 points (indices 0..9) are the outer arc
    for (let i = 0; i < 10; i++) {
      const dist = turf.distance(center, turf.point(ring[i]), { units: 'nauticalmiles' })
      expect(dist).toBeCloseTo(20, 0)
    }
    // next 10 points (indices 10..19) are the reversed inner arc
    for (let i = 10; i < 20; i++) {
      const dist = turf.distance(center, turf.point(ring[i]), { units: 'nauticalmiles' })
      expect(dist).toBeCloseTo(5, 0)
    }
  })

  it('handles a wraparound sector (300deg -> 60deg) by sweeping clockwise through 0/360', () => {
    const s = sector({ fromBrgTrue: 300, toBrgTrue: 60, innerNm: 0, outerNm: 10 })
    const stepDeg = 20 // sweep = 120 -> 6 steps -> 7 arc points
    const ring = sectorPolygon(CENTER_LAT, CENTER_LON, s, stepDeg)

    // pie slice: [center, ...arc(7), center] = 9
    expect(ring.length).toBe(9)

    const center = turf.point([CENTER_LON, CENTER_LAT])
    // midpoint of the arc (index 1 + 3 = 4) should sit at bearing (300+120/2)%360 = 0
    const midPoint = turf.point(ring[4])
    const brg = (turf.bearing(center, midPoint) + 360) % 360
    expect(brg).toBeCloseTo(0, 0)

    // arc start (index 1) should be at bearing 300
    const startBrg = (turf.bearing(center, turf.point(ring[1])) + 360) % 360
    expect(startBrg).toBeCloseTo(300, 0)

    // arc end (index 7) should be at bearing 60
    const endBrg = (turf.bearing(center, turf.point(ring[7])) + 360) % 360
    expect(endBrg).toBeCloseTo(60, 0)
  })

  it('treats fromBrgTrue === toBrgTrue as a full 360deg circle', () => {
    const s = sector({ fromBrgTrue: 45, toBrgTrue: 45, innerNm: 0, outerNm: 15 })
    const stepDeg = 90 // sweep 360 -> 4 steps -> 5 arc points
    const ring = sectorPolygon(CENTER_LAT, CENTER_LON, s, stepDeg)

    expect(ring.length).toBe(7) // [center, arc(5), center]

    const center = turf.point([CENTER_LON, CENTER_LAT])
    const firstArcPt = turf.point(ring[1])
    const lastArcPt = turf.point(ring[5])
    // full circle: the arc's first and last sampled points coincide
    expect(turf.distance(center, firstArcPt, { units: 'nauticalmiles' })).toBeCloseTo(15, 1)
    expect(turf.distance(firstArcPt, lastArcPt, { units: 'nauticalmiles' })).toBeCloseTo(0, 3)

    // and a point on the opposite side of the circle is also present
    const oppositeBrg = (turf.bearing(center, turf.point(ring[3])) + 360) % 360
    expect(oppositeBrg).toBeCloseTo(225, 0)
  })
})

describe('sectorBoundaryLines', () => {
  it('produces line geometry without throwing for a multi-sector TAA', () => {
    const area: SafeAltitudeArea = {
      kind: 'TAA',
      icao: 'KTST',
      procedureIds: ['P1'],
      centerFixId: 'FIXXX',
      centerLat: CENTER_LAT,
      centerLon: CENTER_LON,
      sectors: [
        sector({ fromBrgTrue: 0, toBrgTrue: 120, innerNm: 0, outerNm: 25, altitudeFt: 6000 }),
        sector({ fromBrgTrue: 120, toBrgTrue: 240, innerNm: 0, outerNm: 25, altitudeFt: 5000 }),
        sector({ fromBrgTrue: 240, toBrgTrue: 360, innerNm: 4, outerNm: 25, altitudeFt: 4000 }),
      ],
    }
    const lines = sectorBoundaryLines(area)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('skips radial dividers for a single full-circle sector', () => {
    const area: SafeAltitudeArea = {
      kind: 'MSA',
      icao: 'KTST',
      procedureIds: [],
      centerFixId: 'FIXXX',
      centerLat: CENTER_LAT,
      centerLon: CENTER_LON,
      sectors: [sector({ fromBrgTrue: 0, toBrgTrue: 0, innerNm: 0, outerNm: 25 })],
    }
    const lines = sectorBoundaryLines(area)
    // only the single outer-arc line, no radials
    expect(lines.length).toBe(1)
  })
})

describe('sectorLabelAnchor', () => {
  const wholeWorldBounds = { west: -180, south: -90, east: 180, north: 90 }

  it('anchors near the angular center at mid-radius when the whole sector is visible', () => {
    const s = sector({ fromBrgTrue: 0, toBrgTrue: 90, innerNm: 0, outerNm: 20 })
    const anchor = sectorLabelAnchor(CENTER_LAT, CENTER_LON, s, wholeWorldBounds)
    expect(anchor).not.toBeNull()

    const center = turf.point([CENTER_LON, CENTER_LAT])
    const anchorPt = turf.point(anchor as [number, number])
    const dist = turf.distance(center, anchorPt, { units: 'nauticalmiles' })
    const brg = (turf.bearing(center, anchorPt) + 360) % 360

    expect(dist).toBeCloseTo(10, 0) // mid(0,20) = 10
    expect(brg).toBeCloseTo(45, 0) // angular center of 0..90
  })

  it('picks an anchor within the visible half when bounds cover only part of the sector', () => {
    // Sector spans west -> north -> east (270 -> 90, sweep 180).
    const s = sector({ fromBrgTrue: 270, toBrgTrue: 90, innerNm: 0, outerNm: 10 })
    // Bounds only include the eastern hemisphere (lon >= 0), i.e. bearings ~0..90.
    const halfBounds = { west: 0, south: -90, east: 180, north: 90 }

    const anchor = sectorLabelAnchor(CENTER_LAT, CENTER_LON, s, halfBounds)
    expect(anchor).not.toBeNull()

    const center = turf.point([CENTER_LON, CENTER_LAT])
    const anchorPt = turf.point(anchor as [number, number])
    const brg = (turf.bearing(center, anchorPt) + 360) % 360

    // Must fall in the visible slice (bearings 0..90), not the excluded
    // western portion (bearings 270..360).
    expect(brg).toBeGreaterThanOrEqual(-0.5)
    expect(brg).toBeLessThanOrEqual(90.5)
  })

  it('returns null when the sector never intersects the viewport', () => {
    const s = sector({ fromBrgTrue: 0, toBrgTrue: 90, innerNm: 0, outerNm: 10 })
    const farAwayBounds = { west: 100, south: 80, east: 110, north: 85 }
    const anchor = sectorLabelAnchor(CENTER_LAT, CENTER_LON, s, farAwayBounds)
    expect(anchor).toBeNull()
  })
})

describe('chooseSafeAltitudeArea', () => {
  function area(overrides: Partial<SafeAltitudeArea>): SafeAltitudeArea {
    return {
      kind: 'MSA',
      icao: 'KTST',
      procedureIds: [],
      centerFixId: 'FIXXX',
      centerLat: 0,
      centerLon: 0,
      sectors: [sector()],
      ...overrides,
    }
  }

  it('returns null for empty candidates', () => {
    expect(chooseSafeAltitudeArea([], () => false, () => 0)).toBeNull()
  })

  it('prefers any TAA over any MSA regardless of visibility/traffic', () => {
    const msa = area({ kind: 'MSA', procedureIds: ['M1'] })
    const taa = area({ kind: 'TAA', procedureIds: [] })
    const result = chooseSafeAltitudeArea(
      [msa, taa],
      (id) => id === 'M1', // MSA's procedure is visible, TAA has none
      (id) => (id === 'M1' ? 99 : 0), // MSA has huge traffic average
    )
    expect(result).toBe(taa)
  })

  it('within the same kind, prefers an area with a visible procedure over one with none', () => {
    const hidden = area({ kind: 'TAA', procedureIds: ['A1'] })
    const visible = area({ kind: 'TAA', procedureIds: ['A2'] })
    const result = chooseSafeAltitudeArea(
      [hidden, visible],
      (id) => id === 'A2',
      () => 0,
    )
    expect(result).toBe(visible)
  })

  it('breaks remaining ties on the highest average detected-traffic count', () => {
    const low = area({ kind: 'TAA', procedureIds: ['A1'] })
    const high = area({ kind: 'TAA', procedureIds: ['A2', 'A3'] })
    const result = chooseSafeAltitudeArea(
      [low, high],
      () => false, // neither visible
      (id) => (id === 'A1' ? 2 : id === 'A3' ? 5 : 0),
    )
    expect(result).toBe(high)
  })

  it('keeps the first candidate on a full tie (stable order)', () => {
    const first = area({ kind: 'TAA', procedureIds: ['A1'] })
    const second = area({ kind: 'TAA', procedureIds: ['A2'] })
    const result = chooseSafeAltitudeArea(
      [first, second],
      () => false,
      () => 3,
    )
    expect(result).toBe(first)
  })

  it('treats empty procedureIds as unvisible with zero average', () => {
    const empty = area({ kind: 'TAA', procedureIds: [] })
    const withProc = area({ kind: 'TAA', procedureIds: ['A1'] })
    const result = chooseSafeAltitudeArea(
      [empty, withProc],
      () => false,
      () => 1,
    )
    expect(result).toBe(withProc)
  })
})
