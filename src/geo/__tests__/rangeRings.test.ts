import { describe, it, expect } from 'vitest'
import * as turf from '@turf/turf'
import { ringRadiiForZoom, ringFeatures, ringBadges } from '../rangeRings'

const LAT = 47.4
const LON = -122.3

describe('ringRadiiForZoom', () => {
  it('zoom 11 -> [1, 3, 6]', () => {
    expect(ringRadiiForZoom(11)).toEqual([1, 3, 6])
  })

  it('zoom 10.99 -> [2, 5, 10]', () => {
    expect(ringRadiiForZoom(10.99)).toEqual([2, 5, 10])
  })

  it('zoom 9.5 -> [2, 5, 10]', () => {
    expect(ringRadiiForZoom(9.5)).toEqual([2, 5, 10])
  })

  it('zoom 9.49 -> [5, 10, 15]', () => {
    expect(ringRadiiForZoom(9.49)).toEqual([5, 10, 15])
  })

  it('zoom 8 -> [5, 10, 15]', () => {
    expect(ringRadiiForZoom(8)).toEqual([5, 10, 15])
  })

  it('zoom 7.99 -> [12, 25, 50]', () => {
    expect(ringRadiiForZoom(7.99)).toEqual([12, 25, 50])
  })

  it('very high zoom -> [1, 3, 6]', () => {
    expect(ringRadiiForZoom(20)).toEqual([1, 3, 6])
  })

  it('very low zoom -> [12, 25, 50]', () => {
    expect(ringRadiiForZoom(-100)).toEqual([12, 25, 50])
  })
})

describe('ringFeatures', () => {
  const fc = ringFeatures(LAT, LON, [1, 3, 6])

  it('produces one feature per radius', () => {
    expect(fc.features.length).toBe(3)
  })

  it('each ring has ~65 positions and is closed (first ≈ last)', () => {
    for (const f of fc.features) {
      const coords = f.geometry.coordinates
      expect(coords.length).toBeGreaterThanOrEqual(64)
      expect(coords.length).toBeLessThanOrEqual(66)
      const [firstLon, firstLat] = coords[0]
      const [lastLon, lastLat] = coords[coords.length - 1]
      expect(firstLon).toBeCloseTo(lastLon, 6)
      expect(firstLat).toBeCloseTo(lastLat, 6)
    }
  })

  it('sets the radiusNm property to match input order', () => {
    expect(fc.features.map((f) => f.properties.radiusNm)).toEqual([1, 3, 6])
  })

  it('ring points sit ~radiusNm from the center', () => {
    const center = turf.point([LON, LAT])
    for (const f of fc.features) {
      const radiusNm = f.properties.radiusNm
      for (const pt of f.geometry.coordinates) {
        const d = turf.distance(center, turf.point(pt), { units: 'nauticalmiles' })
        expect(d).toBeCloseTo(radiusNm, 1)
      }
    }
  })
})

describe('ringBadges', () => {
  // Fake project: treat lat as a linear proxy for screen y (higher lat -> smaller y,
  // i.e. further "up" the viewport), independent of lon.
  const projectFromLat =
    (originLat: number) =>
    ([, lat]: [number, number]): { x: number; y: number } | null => ({
      x: 0,
      y: (originLat - lat) * 1000 + 500,
    })

  it('uses the 12 o’clock point (bearing 0) when it projects safely inside the viewport', () => {
    const badges = ringBadges(LAT, LON, [1, 3, 6], projectFromLat(LAT), 8)
    for (const b of badges) {
      expect(b.position).toBe('12')
      expect(b.lat).toBeGreaterThan(LAT) // bearing 0 = due north = higher latitude
    }
  })

  it('flips to 6 o’clock when the 12 o’clock point projects above viewportTopPx', () => {
    // Project so that ANY point north of center (12 o'clock) lands with y < viewportTopPx.
    const project = ([, lat]: [number, number]): { x: number; y: number } | null =>
      lat > LAT ? { x: 0, y: -50 } : { x: 0, y: 500 }
    const badges = ringBadges(LAT, LON, [1, 3, 6], project, 8)
    for (const b of badges) {
      expect(b.position).toBe('6')
      expect(b.lat).toBeLessThan(LAT) // bearing 180 = due south = lower latitude
    }
  })

  it('falls back to 6 o’clock when project returns null', () => {
    const badges = ringBadges(LAT, LON, [1, 3, 6], () => null, 8)
    for (const b of badges) {
      expect(b.position).toBe('6')
    }
  })

  it('badge lat/lon sit ~radiusNm from the center', () => {
    const center = turf.point([LON, LAT])
    const badges = ringBadges(LAT, LON, [1, 3, 6], projectFromLat(LAT), 8)
    for (const b of badges) {
      const d = turf.distance(center, turf.point([b.lon, b.lat]), { units: 'nauticalmiles' })
      expect(d).toBeCloseTo(b.radiusNm, 1)
    }
  })
})
