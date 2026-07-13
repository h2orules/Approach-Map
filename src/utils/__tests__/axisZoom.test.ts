import { describe, it, expect } from 'vitest'
import {
  axisZooms,
  applyAxisZoomDelta,
  stretchScales,
  stretchTrackDeg,
  stretchRotationDeg,
  formatStretchFactor,
} from '../axisZoom'
import { AXIS_ZOOM_MAX_RATIO } from '../../config/constants'

describe('axisZooms', () => {
  it('is identity at ratio 0', () => {
    expect(axisZooms({ zoom: 11, axisRatio: 0 })).toEqual({ zoomX: 11, zoomY: 11 })
  })

  it('puts the extra zoom on Y for positive ratios', () => {
    expect(axisZooms({ zoom: 11, axisRatio: 1.5 })).toEqual({ zoomX: 11, zoomY: 12.5 })
  })

  it('puts the extra zoom on X for negative ratios', () => {
    expect(axisZooms({ zoom: 11, axisRatio: -2 })).toEqual({ zoomX: 13, zoomY: 11 })
  })
})

describe('applyAxisZoomDelta', () => {
  it('vertical zoom-in from 1:1 raises the ratio, base unchanged', () => {
    expect(applyAxisZoomDelta({ zoom: 11, axisRatio: 0 }, 'v', 0.5)).toEqual({
      zoom: 11,
      axisRatio: 0.5,
    })
  })

  it('horizontal zoom-in from 1:1 lowers the ratio, base unchanged', () => {
    expect(applyAxisZoomDelta({ zoom: 11, axisRatio: 0 }, 'h', 0.5)).toEqual({
      zoom: 11,
      axisRatio: -0.5,
    })
  })

  it('vertical zoom-out from 1:1 lowers the base (Y becomes the min axis)', () => {
    expect(applyAxisZoomDelta({ zoom: 11, axisRatio: 0 }, 'v', -0.5)).toEqual({
      zoom: 10.5,
      axisRatio: -0.5,
    })
  })

  it('leaves the untouched axis zoom invariant across any single-axis change', () => {
    const before = { zoom: 11, axisRatio: 1 }
    const { zoomY: yBefore } = axisZooms(before)
    const after = applyAxisZoomDelta(before, 'h', 2) // crosses ratio zero
    const { zoomX: xAfter, zoomY: yAfter } = axisZooms(after)
    expect(yAfter).toBeCloseTo(yBefore)
    expect(xAfter).toBeCloseTo(axisZooms(before).zoomX + 2)
    expect(after.axisRatio).toBeCloseTo(-1)
    expect(after.zoom).toBeCloseTo(12) // min(13, 12)
  })

  it('clamps the ratio at +max and is a no-op past it', () => {
    const at = { zoom: 11, axisRatio: AXIS_ZOOM_MAX_RATIO }
    expect(applyAxisZoomDelta(at, 'v', 0.5)).toEqual(at)
  })

  it('clamps the ratio at -max and is a no-op past it', () => {
    const at = { zoom: 11, axisRatio: -AXIS_ZOOM_MAX_RATIO }
    expect(applyAxisZoomDelta(at, 'h', 0.5)).toEqual(at)
  })

  it('a partially clamped delta still applies the allowed portion', () => {
    const near = { zoom: 11, axisRatio: AXIS_ZOOM_MAX_RATIO - 0.25 }
    const out = applyAxisZoomDelta(near, 'v', 0.5)
    expect(out.axisRatio).toBeCloseTo(AXIS_ZOOM_MAX_RATIO)
    expect(out.zoom).toBe(11)
  })
})

describe('stretchScales', () => {
  it('is 1:1 at ratio 0', () => {
    expect(stretchScales(0)).toEqual({ sx: 1, sy: 1 })
  })

  it('stretches Y for positive ratios, X stays 1', () => {
    expect(stretchScales(1)).toEqual({ sx: 1, sy: 2 })
    expect(stretchScales(3)).toEqual({ sx: 1, sy: 8 })
  })

  it('stretches X for negative ratios, Y stays 1', () => {
    expect(stretchScales(-1)).toEqual({ sx: 2, sy: 1 })
  })

  it('never returns a factor below 1 (frame never renders oversized)', () => {
    for (const r of [-3, -0.5, 0, 0.5, 3]) {
      const { sx, sy } = stretchScales(r)
      expect(sx).toBeGreaterThanOrEqual(1)
      expect(sy).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('stretchTrackDeg', () => {
  it('is identity at 1:1', () => {
    expect(stretchTrackDeg(123, 1, 1)).toBe(123)
  })

  it('leaves the cardinal directions fixed', () => {
    for (const d of [0, 90, 180, 270]) {
      expect(stretchTrackDeg(d, 1, 2)).toBeCloseTo(d)
      expect(stretchTrackDeg(d, 2, 1)).toBeCloseTo(d)
    }
  })

  it('a NE track looks more northerly under vertical stretch', () => {
    // atan2(sin45, 2·cos45) = 26.57°
    expect(stretchTrackDeg(45, 1, 2)).toBeCloseTo(26.57, 1)
  })

  it('a SE track mirrors correctly (stays in the SE quadrant)', () => {
    expect(stretchTrackDeg(135, 1, 2)).toBeCloseTo(180 - 26.57, 1)
  })

  it('a NE track looks more easterly under horizontal stretch', () => {
    expect(stretchTrackDeg(45, 2, 1)).toBeCloseTo(90 - 26.57, 1)
  })
})

describe('stretchRotationDeg', () => {
  it('is identity at 1:1', () => {
    expect(stretchRotationDeg(30, 1, 1)).toBe(30)
  })

  it('keeps horizontal and vertical text axes fixed', () => {
    expect(stretchRotationDeg(0, 1, 2)).toBeCloseTo(0)
    expect(stretchRotationDeg(90, 2, 1)).toBeCloseTo(90)
  })

  it('steepens a 45° rotation under vertical stretch', () => {
    // Screen y is down: a +45° (downhill-right) line doubles its rise.
    expect(stretchRotationDeg(45, 1, 2)).toBeCloseTo(63.43, 1)
  })
})

describe('formatStretchFactor', () => {
  it('formats whole and fractional factors', () => {
    expect(formatStretchFactor(0)).toBe('1×')
    expect(formatStretchFactor(1)).toBe('2×')
    expect(formatStretchFactor(-1)).toBe('2×')
    expect(formatStretchFactor(0.5)).toBe('1.4×')
    expect(formatStretchFactor(1.5)).toBe('2.8×')
    expect(formatStretchFactor(3)).toBe('8×')
  })
})
