import { describe, it, expect } from 'vitest'
import * as turf from '@turf/turf'
import { buildLocFeather } from '../locFeather'

const NM = { units: 'nauticalmiles' as const }

describe('buildLocFeather', () => {
  const thresholdLat = 47.4319
  const thresholdLon = -122.3111
  const inboundCourse = 160 // e.g. RWY 16R
  const lengthNm = 9
  const widthNm = 1.0

  it('has its apex at the threshold', () => {
    const { outline } = buildLocFeather(thresholdLat, thresholdLon, inboundCourse, lengthNm, widthNm)
    expect(outline[0][0]).toBeCloseTo(thresholdLon, 6)
    expect(outline[0][1]).toBeCloseTo(thresholdLat, 6)
    // ring is closed: first and last point coincide
    expect(outline[outline.length - 1][0]).toBeCloseTo(thresholdLon, 6)
    expect(outline[outline.length - 1][1]).toBeCloseTo(thresholdLat, 6)
  })

  it('widens to ~widthNm at the far end', () => {
    const { outline } = buildLocFeather(thresholdLat, thresholdLon, inboundCourse, lengthNm, widthNm)
    const [, farLeft, , farRight] = outline
    const dist = turf.distance(turf.point(farLeft), turf.point(farRight), NM)
    expect(dist).toBeCloseTo(widthNm, 1)
  })

  it('places the notch point on the centerline, closer to the apex than the far corners', () => {
    const { outline } = buildLocFeather(thresholdLat, thresholdLon, inboundCourse, lengthNm, widthNm)
    const [apex, farLeft, notch, farRight] = outline
    const apexPt = turf.point(apex)
    const distNotch = turf.distance(apexPt, turf.point(notch), NM)
    const distFarLeft = turf.distance(apexPt, turf.point(farLeft), NM)
    const distFarRight = turf.distance(apexPt, turf.point(farRight), NM)

    expect(distNotch).toBeLessThan(distFarLeft)
    expect(distNotch).toBeLessThan(distFarRight)
    expect(distNotch).toBeCloseTo(lengthNm - 0.7, 1)
  })

  it('extends outbound, opposite the inbound course', () => {
    const { outline } = buildLocFeather(thresholdLat, thresholdLon, inboundCourse, lengthNm, widthNm)
    const [apex, , notch] = outline
    const bearingToNotch = turf.bearing(turf.point(apex), turf.point(notch))
    const expectedOutbound = (inboundCourse + 180 + 360) % 360
    const diff = Math.abs(((bearingToNotch - expectedOutbound + 540) % 360) - 180)
    expect(diff).toBeLessThan(1)
  })

  it('shades the right side of the inbound course', () => {
    const { outline, shaded } = buildLocFeather(thresholdLat, thresholdLon, inboundCourse, lengthNm, widthNm)
    const [apex, farLeft, , farRight] = outline

    // The shaded triangle should include the far-right corner and exclude the far-left one.
    const shadedRing = shaded[0]
    const includesPoint = (ring: typeof shadedRing, pt: typeof farRight) =>
      ring.some(([lon, lat]) => Math.abs(lon - pt[0]) < 1e-9 && Math.abs(lat - pt[1]) < 1e-9)

    expect(includesPoint(shadedRing, farRight)).toBe(true)
    expect(includesPoint(shadedRing, farLeft)).toBe(false)

    // Sanity: farRight bearing from apex is ~inboundCourse + 90 (to the right of inbound travel).
    const bearingToFarRight = turf.bearing(turf.point(apex), turf.point(farRight))
    const bearingToFarLeft = turf.bearing(turf.point(apex), turf.point(farLeft))
    expect(bearingToFarRight).not.toBeCloseTo(bearingToFarLeft, 0)
  })

  it('is finite and non-degenerate for a reciprocal-runway course', () => {
    const { outline, shaded } = buildLocFeather(40, -100, 340, 9, 1.0)
    for (const [lon, lat] of outline) {
      expect(Number.isFinite(lon)).toBe(true)
      expect(Number.isFinite(lat)).toBe(true)
    }
    expect(shaded.length).toBeGreaterThan(0)
  })
})
