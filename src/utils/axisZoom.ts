import { AXIS_ZOOM_MAX_RATIO } from '../config/constants'

/**
 * Anisotropic (per-axis) zoom math.
 *
 * Mapbox has a single zoom level, so per-axis zoom is modeled as:
 *   - the mapbox zoom is always the LESS zoomed of the two axes
 *     (`zoom = min(zoomX, zoomY)`), and
 *   - `axisRatio = zoomY - zoomX` (zoom levels; positive = vertical axis is
 *     zoomed in further, negative = horizontal further, 0 = normal 1:1).
 *
 * The more-zoomed axis is produced by CSS-scaling the map frame UP along that
 * axis by 2^|axisRatio| (AxisStretchFrame). Keying the mapbox zoom to the
 * minimum means the frame is always scaled up (never down), so the map never
 * renders more pixels than the viewport needs.
 *
 * Because the stretch is a fixed CSS transform independent of the mapbox
 * zoom, every ordinary zoom mechanism (wheel, pinch, double-click, the
 * NavigationControl buttons) changes both axes together and preserves the
 * ratio — exactly the required proportional behavior.
 */

export type ZoomAxis = 'h' | 'v'

export interface AxisZoomView {
  /** Mapbox base zoom — always min(zoomX, zoomY). */
  zoom: number
  /** zoomY - zoomX in zoom levels, clamped to ±AXIS_ZOOM_MAX_RATIO. */
  axisRatio: number
}

/** Effective per-axis zoom levels for a (base zoom, ratio) pair. */
export function axisZooms(view: AxisZoomView): { zoomX: number; zoomY: number } {
  return view.axisRatio >= 0
    ? { zoomX: view.zoom, zoomY: view.zoom + view.axisRatio }
    : { zoomX: view.zoom - view.axisRatio, zoomY: view.zoom }
}

/**
 * Apply a zoom delta to ONE axis, leaving the other axis's effective zoom
 * unchanged. Returns the new base zoom + ratio. The ratio is clamped to
 * ±AXIS_ZOOM_MAX_RATIO by refusing the part of the delta that would exceed
 * it (so a click at the limit is a no-op, not a proportional zoom).
 */
export function applyAxisZoomDelta(
  view: AxisZoomView,
  axis: ZoomAxis,
  delta: number,
): AxisZoomView {
  let { zoomX, zoomY } = axisZooms(view)
  if (axis === 'h') zoomX += delta
  else zoomY += delta

  const ratio = zoomY - zoomX
  if (ratio > AXIS_ZOOM_MAX_RATIO) {
    if (axis === 'v') zoomY = zoomX + AXIS_ZOOM_MAX_RATIO
    else zoomX = zoomY - AXIS_ZOOM_MAX_RATIO
  } else if (ratio < -AXIS_ZOOM_MAX_RATIO) {
    if (axis === 'h') zoomX = zoomY + AXIS_ZOOM_MAX_RATIO
    else zoomY = zoomX - AXIS_ZOOM_MAX_RATIO
  }

  return { zoom: Math.min(zoomX, zoomY), axisRatio: zoomY - zoomX }
}

/**
 * CSS scale factors for the map frame. The stretched axis is the MORE zoomed
 * one, so both factors are always ≥ 1 (the frame is laid out smaller than the
 * viewport along that axis and scaled up to fill it).
 */
export function stretchScales(axisRatio: number): { sx: number; sy: number } {
  return {
    sx: axisRatio < 0 ? 2 ** -axisRatio : 1,
    sy: axisRatio > 0 ? 2 ** axisRatio : 1,
  }
}

const norm360 = (d: number): number => ((d % 360) + 360) % 360

/**
 * Visual screen direction of a ground track under an axis stretch: a track of
 * `deg` (0 = up/north, clockwise) drawn on a map stretched by (sx, sy) points
 * along atan2(sx·sin, sy·cos). Used to keep crisp (counter-scaled or
 * overlay-drawn) aircraft icons aligned with their visually stretched
 * trajectory. Identity when sx = sy = 1.
 */
export function stretchTrackDeg(deg: number, sx: number, sy: number): number {
  if (sx === 1 && sy === 1) return deg
  const r = (deg * Math.PI) / 180
  return norm360((Math.atan2(sx * Math.sin(r), sy * Math.cos(r)) * 180) / Math.PI)
}

/**
 * Same correction for a CSS rotate() angle (0 = horizontal text baseline,
 * positive = clockwise, screen y down): a line at `deg` renders at
 * atan2(sy·sin, sx·cos) once stretched. Used by counter-scaled rotated labels
 * so they stay parallel to the (stretched) leg they annotate.
 */
export function stretchRotationDeg(deg: number, sx: number, sy: number): number {
  if (sx === 1 && sy === 1) return deg
  const r = (deg * Math.PI) / 180
  return (Math.atan2(sy * Math.sin(r), sx * Math.cos(r)) * 180) / Math.PI
}

/** "2×", "2.8×" — display factor for the current ratio's magnitude. */
export function formatStretchFactor(axisRatio: number): string {
  const f = 2 ** Math.abs(axisRatio)
  const rounded = Math.round(f * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}×`
}
