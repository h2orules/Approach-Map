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

// ---- FAF "maltese cross" (cross patée) ------------------------------------
// FAA final-approach-fix symbol: four arms narrow at the waist, flaring wide at
// the tips, each tip cut with a V-notch — not a plain plus/pointed star. Drawn
// centered on the origin and UPRIGHT; callers apply their own
// `translate(...) rotate(45)` and fill/stroke. Shared so the map FAF marker
// (WaypointMarkers) and the vertical profile (ProfileSvg) render the identical
// shape. Spans ≈ ±8.7px from center once rotated 45°.
export const MALTESE_PATH = (() => {
  const w = 1.7 // half-width at the waist (center)
  const t = 4.8 // half-width at each arm tip
  const L = 7.5 // arm length from center
  const n = 2.0 // tip V-notch depth
  return (
    `M ${-w} ${-w} L ${-t} ${-L} L 0 ${-L + n} L ${t} ${-L} L ${w} ${-w} ` +
    `L ${L} ${-t} L ${L - n} 0 L ${L} ${t} L ${w} ${w} ` +
    `L ${t} ${L} L 0 ${L - n} L ${-t} ${L} L ${-w} ${w} ` +
    `L ${-L} ${t} L ${-L + n} 0 L ${-L} ${-t} Z`
  )
})()

// ---- marker beacon (lens) + optional locator (NDB) overlay ----------------
// FAA marker-beacon symbol: a horizontal convex lens ("eye") stippled with
// dots. A Locator Outer Marker (LOM) adds the FAA NDB symbol — a center dot
// ringed by concentric dots — drawn over the lens. Centered on the origin so
// the map can wrap it in its own <svg> (standalone) and place it under a fix.
const MARKER_COLOR = '#fbbf24'

// Pointed-ellipse ("eye") reaching ±13 wide, ±5 tall (quad control at ±10 so
// the curve peaks at ±5 rather than ±2.5).
const MARKER_LENS_PATH = 'M -13 0 Q 0 -10 13 0 Q 0 10 -13 0 Z'

// Concentric rings of dots forming the FAA NDB symbol, radiating from center.
function ndbRingDots(): Pt[] {
  const dots: Pt[] = []
  for (const [r, n] of [[3.2, 8], [5.4, 10]] as const) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      dots.push({ x: r * Math.cos(a), y: r * 0.62 * Math.sin(a) }) // flattened to fit the lens height
    }
  }
  return dots
}

interface MarkerLensProps {
  /** LOM: overlay the NDB dot-rings on the lens. */
  locator?: boolean
  className?: string
  standalone?: boolean
}

export function MarkerLens({ locator = false, className, standalone = true }: MarkerLensProps) {
  const halo = { stroke: '#0b0f14', strokeWidth: 0.5 }
  const content = (
    <g className={className}>
      {/* lens outline over a dark wash so the amber stipple reads on any basemap */}
      <path d={MARKER_LENS_PATH} fill="rgba(11,15,20,0.55)" stroke={MARKER_COLOR} strokeWidth={1} />
      {locator ? (
        <>
          {ndbRingDots().map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={0.75} fill={MARKER_COLOR} />
          ))}
          <circle cx={0} cy={0} r={1.7} fill={MARKER_COLOR} {...halo} />
        </>
      ) : (
        // Plain marker: a simple row of stipple dots inside the lens.
        [-8, -4, 0, 4, 8].map((x, i) => (
          <circle key={i} cx={x} cy={0} r={0.9} fill={MARKER_COLOR} />
        ))
      )}
    </g>
  )

  if (!standalone) return content
  return (
    <svg
      width={58}
      height={33}
      viewBox="-16 -9 32 18"
      className={className}
      style={{ display: 'block', overflow: 'visible' }}
      aria-label={locator ? 'Locator outer marker' : 'Marker beacon'}
    >
      {content}
    </svg>
  )
}

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
