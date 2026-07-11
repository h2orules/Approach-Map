import { describe, it, expect } from 'vitest'
import * as turf from '@turf/turf'
import {
  holdTrack,
  holdOutboundLabelAnchor,
  procedureTurn,
  procedureTurnDrawnLengthNm,
  dmeArc,
} from '../procedureShapes'

const finite = (pts: [number, number][]) =>
  pts.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))

// Signed lateral side of point p relative to the outbound course through F:
// >0 = the +45° (left-turn barb) side, <0 = the −45° (right-turn barb) side.
const side = (F: [number, number], p: [number, number], outbound: number) => {
  const b = turf.bearing(turf.point(F), turf.point(p))
  const delta = ((b - outbound + 540) % 360) - 180
  return Math.sin((delta * Math.PI) / 180)
}

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

describe('holdOutboundLabelAnchor', () => {
  it('returns the outbound (reciprocal) course and a finite anchor near the fix', () => {
    const a = holdOutboundLabelAnchor(47.65, -122.31, 342, false, 4)
    expect(a.courseTrue).toBeCloseTo(162, 6)
    expect(Number.isFinite(a.lat) && Number.isFinite(a.lon)).toBe(true)
    const d = turf.distance(turf.point([-122.31, 47.65]), turf.point([a.lon, a.lat]), {
      units: 'nauticalmiles',
    })
    expect(d).toBeGreaterThan(1)
    expect(d).toBeLessThan(5)
  })

  it('places the outbound leg on the turn side (left → west, right → east)', () => {
    const l = holdOutboundLabelAnchor(47.65, -122.31, 342, false, 4)
    const r = holdOutboundLabelAnchor(47.65, -122.31, 342, true, 4)
    expect(l.lon).toBeLessThan(-122.31)
    expect(r.lon).toBeGreaterThan(-122.31)
  })

  it('lands on the drawn outbound straight leg (matches holdTrack geometry)', () => {
    const track = holdTrack(47.65, -122.31, 342, false, 4)
    const a = holdOutboundLabelAnchor(47.65, -122.31, 342, false, 4)
    const dist = turf.pointToLineDistance(turf.point([a.lon, a.lat]), turf.lineString(track), {
      units: 'nauticalmiles',
    })
    expect(dist).toBeLessThan(0.2)
  })
})

describe('procedureTurnDrawnLengthNm', () => {
  it('clamps the remain-within limit to 2–5 nm', () => {
    expect(procedureTurnDrawnLengthNm(10)).toBe(5)
    expect(procedureTurnDrawnLengthNm(3)).toBe(3)
    expect(procedureTurnDrawnLengthNm(0)).toBe(2)
    expect(procedureTurnDrawnLengthNm(1)).toBe(2)
  })
})

describe('procedureTurn', () => {
  it('draws the fix, outbound end, barb tip, and half-arrow wing', () => {
    const pts = procedureTurn(40, -100, 270, true, 4)
    expect(pts.length).toBe(4)
    expect(finite(pts)).toBe(true)
    expect(pts[0]).toEqual([-100, 40])
  })

  it('places the outbound end at the clamped length along the outbound course', () => {
    const F: [number, number] = [-122.31, 47.65]
    const pts = procedureTurn(F[1], F[0], 162, false, 10)
    const end = pts[1]
    expect(turf.distance(turf.point(F), turf.point(end), { units: 'nauticalmiles' })).toBeCloseTo(5, 3)
    expect(turf.bearing(turf.point(F), turf.point(end))).toBeCloseTo(162, 1)
  })

  it('caps the tick with a short half-arrow wing near the barb tip', () => {
    const F: [number, number] = [-122.31, 47.65]
    const pts = procedureTurn(F[1], F[0], 162, false, 10)
    const tip = pts[2]
    const wing = pts[3]
    // the wing is a short sweep back from the tip (well under the tick length)
    const d = turf.distance(turf.point(tip), turf.point(wing), { units: 'nauticalmiles' })
    expect(d).toBeGreaterThan(0.2)
    expect(d).toBeLessThan(1)
  })

  it('puts the barb on the +45° side for a LEFT turn (KAWO: 162° → 207°)', () => {
    const F: [number, number] = [-122.31, 47.65]
    const pts = procedureTurn(F[1], F[0], 162, false, 10)
    // barb tick bearing from the outbound end
    const barbBrg = turf.bearing(turf.point(pts[1]), turf.point(pts[2]))
    expect(((barbBrg - 207 + 540) % 360) - 180).toBeCloseTo(0, 1)
    // no drawn point falls on the anti-barb (−45°) side
    for (const p of pts.slice(1)) expect(side(F, p, 162)).toBeGreaterThanOrEqual(-1e-6)
  })

  it('puts the barb on the −45° side for a RIGHT turn', () => {
    const F: [number, number] = [-100, 40]
    const pts = procedureTurn(F[1], F[0], 90, true, 4)
    const barbBrg = turf.bearing(turf.point(pts[1]), turf.point(pts[2]))
    expect(((barbBrg - 45 + 540) % 360) - 180).toBeCloseTo(0, 1)
    for (const p of pts.slice(1)) expect(side(F, p, 90)).toBeLessThanOrEqual(1e-6)
  })
})

describe('dmeArc', () => {
  // KPAE VOR-A: 9.0 nm DME arc around the PAE VOR. ECEPO (256° true) sweeps
  // clockwise (right turn) to YAVUR (360°/north); CEVLI (50.8°) sweeps
  // counter-clockwise (left) to YAVUR. Coordinates from live FAA CIFP.
  const PAE = { lat: 47.91983333, lon: -122.27780278 }
  const YAVUR = { lat: 48.06973889, lon: -122.2778 }
  const ECEPO = { lat: 47.88336389, lon: -122.49406667 }
  const CEVLI = { lat: 48.014225, lon: -122.10442778 }

  const distNm = (a: [number, number], b: [number, number]) =>
    turf.distance(turf.point(a), turf.point(b), { units: 'nauticalmiles' })

  it('samples a right-turn arc that starts at the start fix and ends at the end fix', () => {
    const arc = dmeArc(PAE.lat, PAE.lon, ECEPO.lat, ECEPO.lon, YAVUR.lat, YAVUR.lon, true)
    expect(arc.length).toBeGreaterThan(6)
    expect(finite(arc)).toBe(true)
    expect(arc[0][0]).toBeCloseTo(ECEPO.lon, 4)
    expect(arc[0][1]).toBeCloseTo(ECEPO.lat, 4)
    expect(arc[arc.length - 1][0]).toBeCloseTo(YAVUR.lon, 4)
    expect(arc[arc.length - 1][1]).toBeCloseTo(YAVUR.lat, 4)
  })

  it('keeps every sampled point on the ~9 nm radius from the station', () => {
    const arc = dmeArc(PAE.lat, PAE.lon, ECEPO.lat, ECEPO.lon, YAVUR.lat, YAVUR.lon, true)
    const center: [number, number] = [PAE.lon, PAE.lat]
    for (const p of arc) expect(distNm(center, p)).toBeGreaterThan(8.5)
    for (const p of arc) expect(distNm(center, p)).toBeLessThan(9.5)
  })

  it('bulges outside the straight chord (i.e. it is actually curved)', () => {
    const arc = dmeArc(PAE.lat, PAE.lon, ECEPO.lat, ECEPO.lon, YAVUR.lat, YAVUR.lon, true)
    const chord = turf.lineString([
      [ECEPO.lon, ECEPO.lat],
      [YAVUR.lon, YAVUR.lat],
    ])
    const mid = arc[Math.floor(arc.length / 2)]
    // The arc midpoint sits well off the chord (a straight chord would be ~0).
    const offNm = turf.pointToLineDistance(turf.point(mid), chord, { units: 'nauticalmiles' })
    expect(offNm).toBeGreaterThan(0.3)
  })

  it('sweeps the short way in the turn direction (left turn from CEVLI stays east of the station)', () => {
    const arc = dmeArc(PAE.lat, PAE.lon, CEVLI.lat, CEVLI.lon, YAVUR.lat, YAVUR.lon, false)
    expect(arc[0][0]).toBeCloseTo(CEVLI.lon, 4)
    expect(arc[arc.length - 1][1]).toBeCloseTo(YAVUR.lat, 4)
    // Every point stays on the east side (lon >= station) — the ~51° short arc
    // from 50.8° to 0° never wraps around the west side.
    for (const p of arc) expect(p[0]).toBeGreaterThanOrEqual(PAE.lon - 0.02)
  })
})
