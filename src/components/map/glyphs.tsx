// Shared FAA-style waypoint glyphs — glideslope-intercept bolt and the
// DME "circumscribed D" distance badge.
//
// These used to live inline in WaypointMarkers.tsx; they're extracted here so
// the map view and the vertical profile (src/components/profile/ProfileSvg.tsx)
// can render the exact same shapes. Each glyph supports two render modes via
// the `standalone` prop:
//
//   - standalone (default, true) — wraps the glyph in its own <svg>, sized and
//     positioned to its own bounding box via inline `left`/`top`/`width`/
//     `height` styles. This is what WaypointMarkers uses today: each glyph is
//     an absolutely-positioned DOM overlay next to a map Marker.
//   - standalone={false} — renders only the inner SVG content (a <g> of
//     paths/polylines/polygons), with coordinates used exactly as given, in
//     whatever coordinate space the caller's own <svg>/viewBox already
//     defines. This is meant for ProfileSvg.tsx (or any other consumer) to
//     drop directly inside its shared chart <svg> without an extra nested
//     <svg> element.
//
// ProfileSvg.tsx is not modified here — it still has its own local BoltGlyph.
// A future change can swap that for `<BoltGlyph standalone={false} .../>`.

export interface Pt { x: number; y: number }

const RESTRICTION_COLOR = '#fde68a'

// ---- glideslope-intercept bolt --------------------------------------------

interface BoltGlyphProps {
  from: Pt
  to: Pt
  className?: string
  standalone?: boolean
}

function boltGeometry(from: Pt, to: Pt) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux
  const lineW = 2
  const amp = lineW * 3.5
  const headLen = 7
  const headW = 5

  const tipGap = 7
  const seg = len - tipGap
  const tip = { x: from.x + ux * seg, y: from.y + uy * seg }

  const along = (t: number, side: number): Pt => ({
    x: from.x + ux * seg * t + px * amp * side,
    y: from.y + uy * seg * t + py * amp * side,
  })
  const p0 = from
  const p1 = along(0.40, 0.5)
  const p2 = along(0.22, -0.5)
  const base = { x: tip.x - ux * headLen, y: tip.y - uy * headLen }

  const wing1 = { x: base.x + px * headW, y: base.y + py * headW }
  const wing2 = { x: base.x - px * headW, y: base.y - py * headW }

  return { p0, p1, p2, base, tip, wing1, wing2, lineW }
}

/**
 * Glideslope-intercept lightning bolt, drawn from `from` toward `to` (the
 * fix). Used on the map next to the fix's data label; the profile view can
 * pass a purely-vertical `from`/`to` pair to get the same shape.
 */
export function BoltGlyph({ from, to, className, standalone = true }: BoltGlyphProps) {
  const { p0, p1, p2, base, tip, wing1, wing2, lineW } = boltGeometry(from, to)

  if (!standalone) {
    return (
      <g className={className}>
        <polyline
          points={`${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y} ${base.x},${base.y}`}
          fill="none"
          stroke={RESTRICTION_COLOR}
          strokeWidth={lineW}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <polygon
          points={`${tip.x},${tip.y} ${wing1.x},${wing1.y} ${wing2.x},${wing2.y}`}
          fill={RESTRICTION_COLOR}
          stroke="#0b0f14"
          strokeWidth={0.6}
        />
      </g>
    )
  }

  const pad = 4
  const all = [p0, p1, p2, base, tip, wing1, wing2]
  const minX = Math.min(...all.map((p) => p.x)) - pad
  const minY = Math.min(...all.map((p) => p.y)) - pad
  const w = Math.max(...all.map((p) => p.x)) - minX + pad
  const h = Math.max(...all.map((p) => p.y)) - minY + pad
  const L = (p: Pt) => `${p.x - minX},${p.y - minY}`

  return (
    <svg className={className} style={{ left: minX, top: minY, width: w, height: h }} width={w} height={h}>
      <polyline
        points={`${L(p0)} ${L(p1)} ${L(p2)} ${L(base)}`}
        fill="none"
        stroke={RESTRICTION_COLOR}
        strokeWidth={lineW}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <polygon points={`${L(tip)} ${L(wing1)} ${L(wing2)}`} fill={RESTRICTION_COLOR} stroke="#0b0f14" strokeWidth={0.6} />
    </svg>
  )
}

// ---- DME "circumscribed D" badge ------------------------------------------
// FAA-standard DME distance indicator: numbers circumscribed inside a D shape.
// The D is formed by a vertical bar on the left, two horizontal lines, and a
// right-side semicircular arc whose radius equals half the badge height.
const DME_H = 14         // px — badge height (fits 10px font with 2px pad each side)
const DME_R = DME_H / 2  // px — right-arc radius
const DME_CHAR_W = 6.5   // px — approx char width at 10px monospace
const DME_PAD_LEFT = 3   // px — left padding, between the left bar and first digit
const DME_PAD_RIGHT = 1.5 // px — right padding, between last digit and the arc (tightened; was 3)
const DME_STROKE_W = 1.7 // px — D-outline stroke width (thickened; was 1.3)

function formatDme(nm: number): string {
  return nm % 1 === 0 ? String(nm) : nm.toFixed(1)
}

function dmeContentWidth(nm: number): number {
  return formatDme(nm).length * DME_CHAR_W + DME_PAD_LEFT + DME_PAD_RIGHT
}

/** Full badge width (content box + right-side arc), for layout/collision math. */
export function dmeGlyphWidth(nm: number): number {
  return dmeContentWidth(nm) + DME_R
}

interface DmeDProps {
  nm: number
  className?: string
  standalone?: boolean
}

/**
 * DME distance value shown inside a "D" outline (a straight left/top/bottom
 * with a right semicircular arc). `standalone` mirrors BoltGlyph: true (the
 * map's usage) wraps its own <svg>; false renders only the <g> content at
 * (0,0), left for the caller to position via a wrapping transform.
 */
export function DmeD({ nm, className, standalone = true }: DmeDProps) {
  const text = formatDme(nm)
  const textW = text.length * DME_CHAR_W
  const contentW = textW + DME_PAD_LEFT + DME_PAD_RIGHT
  const svgW = contentW + DME_R
  const textX = DME_PAD_LEFT + textW / 2

  const content = (
    <>
      {/* D shape: top line → right arc → bottom line → left bar (Z closes it) */}
      <path
        d={`M 0 0 H ${contentW} A ${DME_R} ${DME_R} 0 0 1 ${contentW} ${DME_H} H 0 Z`}
        fill="none"
        stroke={RESTRICTION_COLOR}
        strokeWidth={DME_STROKE_W}
        strokeLinejoin="round"
      />
      <text
        x={textX}
        y={DME_H / 2}
        dy="0.35em"
        textAnchor="middle"
        fontSize={10}
        fontFamily="'Roboto Mono', monospace"
        fill={RESTRICTION_COLOR}
      >
        {text}
      </text>
    </>
  )

  if (!standalone) {
    return <g className={className} aria-label={`DME ${text}`}>{content}</g>
  }

  return (
    <svg
      width={svgW}
      height={DME_H}
      viewBox={`0 0 ${svgW} ${DME_H}`}
      className={className}
      // overflow visible so the D outline's stroke and the right-arc's
      // rightmost point (both sitting exactly on the viewBox edge) aren't
      // clipped — matching how the profile renders the same glyph.
      style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}
      aria-label={`DME ${text}`}
    >
      {content}
    </svg>
  )
}
