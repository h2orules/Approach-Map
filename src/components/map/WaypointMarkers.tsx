import { useEffect, useMemo, useRef, useState } from 'react'
import * as turf from '@turf/turf'
import { Marker, useMap } from 'react-map-gl'
import type { Procedure, WaypointSymbol, AltConstraint } from '../../types/procedure'
import styles from './WaypointMarkers.module.css'

interface Props {
  procedures: Procedure[]
}

const RESTRICTION_COLOR = '#fde68a'

// Below this zoom, labels that can't find a clear spot are dropped. At/above it
// every on-screen label is shown (overlapping only as a last resort).
const DROP_ZOOM = 8
const SEG_LABEL_MIN_ZOOM = 9
const SEG_LABEL_MIN_NM = 0.3   // segments shorter than this aren't labeled
const SEG_OFFSET_NM = 0.25     // perpendicular offset for midpoint labels

function symKey(s: WaypointSymbol): string {
  return `${s.id}:${s.lat.toFixed(4)}:${s.lon.toFixed(4)}`
}

const ROLE_RANK: Record<string, number> = { map: 5, faf: 4, iaf: 3, hold: 2, normal: 1 }

// ---- icons ---------------------------------------------------------------
function Ring({ cx, cy, r, color }: { cx: number; cy: number; r: number; color: string }) {
  return <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.4} opacity={0.85} />
}

function WpIcon({ s, size = 26 }: { s: WaypointSymbol; size?: number }) {
  const halo = { stroke: '#0b0f14', strokeWidth: 1.6, strokeLinejoin: 'round' as const }
  const fo = s.flyover

  if (s.role === 'faf') {
    return (
      <svg width={size} height={size} viewBox="0 0 26 26">
        {fo && <Ring cx={13} cy={13} r={12} color="#f0abfc" />}
        <path d="M13 2 L15.6 8 L13 10.2 L10.4 8 Z M13 24 L15.6 18 L13 15.8 L10.4 18 Z M2 13 L8 10.4 L10.2 13 L8 15.6 Z M24 13 L18 10.4 L15.8 13 L18 15.6 Z" fill="#f0abfc" {...halo} />
      </svg>
    )
  }
  if (s.role === 'map' || s.navaidType === 'RUNWAY') {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20">
        {fo && <Ring cx={10} cy={10} r={8.5} color="#86efac" />}
        <rect x="5" y="5" width="10" height="10" fill="#86efac" {...halo} />
      </svg>
    )
  }
  if (s.navaidType === 'VOR' || s.navaidType === 'VORTAC') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24">
        {fo && <Ring cx={12} cy={12} r={11} color="#7dd3fc" />}
        <path d="M12 3 L20 7.5 L20 16.5 L12 21 L4 16.5 L4 7.5 Z" fill="none" stroke="#7dd3fc" strokeWidth={2.2} />
        <circle cx="12" cy="12" r="2" fill="#7dd3fc" />
      </svg>
    )
  }
  if (s.navaidType === 'NDB') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24">
        {fo && <Ring cx={12} cy={12} r={11} color="#fbbf24" />}
        <circle cx="12" cy="12" r="9" fill="none" stroke="#fbbf24" strokeWidth={1.6} strokeDasharray="1.5 2.2" />
        <circle cx="12" cy="12" r="2.4" fill="#fbbf24" {...halo} />
      </svg>
    )
  }
  // default fix — solid triangle
  return (
    <svg width={size} height={size} viewBox="0 0 22 22">
      {fo && <Ring cx={11} cy={11} r={10} color="#cbd5e1" />}
      <path d="M11 4 L18 17 L4 17 Z" fill="#cbd5e1" {...halo} />
    </svg>
  )
}

// ---- DME badge -----------------------------------------------------------
// FAA-standard DME distance indicator: numbers circumscribed inside a D shape.
// The D is formed by a vertical bar on the left, two horizontal lines, and a
// right-side semicircular arc whose radius equals half the badge height.
const DME_H = 14        // px — badge height (fits 10px font with 2px pad each side)
const DME_R = DME_H / 2 // px — right-arc radius
const DME_CHAR_W = 6.5  // px — approx char width at 10px monospace
const DME_PAD_X = 3     // px — horizontal padding inside the D

function formatDme(nm: number): string {
  return nm % 1 === 0 ? String(nm) : nm.toFixed(1)
}

function dmeBadgeWidth(nm: number): number {
  return formatDme(nm).length * DME_CHAR_W + DME_PAD_X * 2 + DME_R
}

function DmeBadge({ nm }: { nm: number }) {
  const text = formatDme(nm)
  const contentW = text.length * DME_CHAR_W + DME_PAD_X * 2
  const svgW = contentW + DME_R
  return (
    <svg
      width={svgW}
      height={DME_H}
      viewBox={`0 0 ${svgW} ${DME_H}`}
      style={{ display: 'block', flexShrink: 0 }}
      aria-label={`DME ${text}`}
    >
      {/* D shape: top line → right arc → bottom line → left bar (Z closes it) */}
      <path
        d={`M 0 0 H ${contentW} A ${DME_R} ${DME_R} 0 0 1 ${contentW} ${DME_H} H 0 Z`}
        fill="none"
        stroke={RESTRICTION_COLOR}
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
      <text
        x={contentW / 2}
        y={DME_H / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={10}
        fontFamily="'Roboto Mono', monospace"
        fill={RESTRICTION_COLOR}
      >
        {text}
      </text>
    </svg>
  )
}

// ---- restriction labels --------------------------------------------------
const fNum = (n: number) => n.toLocaleString('en-US')

function AltLabel({ c }: { c: AltConstraint }) {
  if (c.type === 'BETWEEN') {
    return (
      <div className={styles.alt}>
        <span className={styles.barAbove}>{fNum(c.high ?? c.low)}</span>
        <span className={styles.barBelow}>{fNum(c.low)}</span>
      </div>
    )
  }
  const cls =
    c.type === 'AT' ? `${styles.barAbove} ${styles.barBelow}`
      : c.type === 'AT_OR_BELOW' ? styles.barAbove
        : styles.barBelow
  const val = c.type === 'AT_OR_BELOW' ? (c.high ?? c.low) : c.low
  return (
    <div className={styles.alt}>
      <span className={cls}>{fNum(val)}</span>
    </div>
  )
}

function SpeedLabel({ kt }: { kt: number }) {
  return (
    <div className={styles.spd}>
      <span className={styles.barAbove}>{kt}Kt</span>
    </div>
  )
}

interface Pt { x: number; y: number }

function BoltArrow({ from, to }: { from: Pt; to: Pt }) {
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

  const pad = 4
  const wing1 = { x: base.x + px * headW, y: base.y + py * headW }
  const wing2 = { x: base.x - px * headW, y: base.y - py * headW }
  const all = [p0, p1, p2, base, tip, wing1, wing2]
  const minX = Math.min(...all.map((p) => p.x)) - pad
  const minY = Math.min(...all.map((p) => p.y)) - pad
  const w = Math.max(...all.map((p) => p.x)) - minX + pad
  const h = Math.max(...all.map((p) => p.y)) - minY + pad
  const L = (p: Pt) => `${p.x - minX},${p.y - minY}`

  return (
    <svg className={styles.bolt} style={{ left: minX, top: minY, width: w, height: h }} width={w} height={h}>
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

// ---- placement -----------------------------------------------------------
interface Placement {
  s: WaypointSymbol
  dx: number
  dy: number
  w: number
  h: number
  placed: boolean
}

interface Rect { x: number; y: number; w: number; h: number }
const inView = (r: Rect, vw: number, vh: number) =>
  r.x >= 2 && r.y >= 2 && r.x + r.w <= vw - 2 && r.y + r.h <= vh - 2

function overlapArea(a: Rect, rects: Rect[]): number {
  let sum = 0
  for (const b of rects) {
    const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
    const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
    sum += ox * oy
  }
  return sum
}

function place(
  sx: number, sy: number, cands: Pt[], w: number, h: number,
  iconRects: Rect[], labelRects: Rect[], vw: number, vh: number, allowOverlap: boolean,
): Pt | null {
  let best: Pt | null = null
  let bestScore = Infinity
  for (const c of cands) {
    const r: Rect = { x: sx + c.x, y: sy + c.y, w, h }
    if (!inView(r, vw, vh)) continue
    const ic = overlapArea(r, iconRects)
    const lc = overlapArea(r, labelRects)
    if (ic === 0 && lc === 0) return c
    const score = ic * 1000 + lc
    if (score < bestScore) { bestScore = score; best = c }
  }
  if (!allowOverlap) return null
  return best ?? cands[0]
}

// Name row width = fix name + optional gap + DME badge.
// Restriction row width = (alt chars + speed chars) * char width.
function labelBoxSize(s: WaypointSymbol): { w: number; h: number } {
  const showAlt = !!s.alt
  const between = showAlt && !s.gsFaf && s.alt!.type === 'BETWEEN'
  const altChars = showAlt ? 6 : 0
  const spdChars = s.speedKt ? 5 : 0
  const rowChars = altChars + (s.speedKt ? 1 + spdChars : 0)

  const dme = s.dmeNm ?? null
  const dmeExtra = dme !== null ? 4 + dmeBadgeWidth(dme) : 0 // 4px gap before badge
  const nameLineW = s.id.length * 8.4 + dmeExtra
  const maxW = Math.max(nameLineW, rowChars * 8.4)
  const rowLines = between ? 2 : showAlt || s.speedKt ? 1 : 0
  return { w: maxW + 6, h: (1 + rowLines) * 15 + 6 }
}

function nearestPointToFix(dx: number, dy: number, w: number, h: number): Pt {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  return { x: clamp(0, dx, dx + w), y: clamp(0, dy, dy + h) }
}

// ---- segment distance labels --------------------------------------------
interface SegLabel {
  key: string
  lon: number
  lat: number
  text: string
  color: string
}

export function WaypointMarkers({ procedures }: Props) {
  const { current: mapRef } = useMap()
  const [placements, setPlacements] = useState<Placement[]>([])
  const [segmentLabels, setSegmentLabels] = useState<SegLabel[]>([])
  const rafRef = useRef<number | null>(null)

  const symbols = useMemo(() => {
    const map = new Map<string, WaypointSymbol>()
    for (const proc of procedures) {
      for (const s of proc.symbols) {
        const k = symKey(s)
        const existing = map.get(k)
        if (!existing) map.set(k, s)
        else if ((ROLE_RANK[s.role] ?? 0) > (ROLE_RANK[existing.role] ?? 0)) map.set(k, s)
      }
    }
    return Array.from(map.values())
  }, [procedures])

  useEffect(() => {
    const map = mapRef?.getMap()
    if (!map) return

    const recompute = () => {
      const zoom = map.getZoom()
      const container = map.getContainer()
      const vw = container.clientWidth
      const vh = container.clientHeight
      const allowOverlap = zoom >= DROP_ZOOM

      // ── Waypoint label placement ──────────────────────────────────────────
      const ordered = [...symbols].sort((a, b) => (ROLE_RANK[b.role] ?? 0) - (ROLE_RANK[a.role] ?? 0))

      const iconRects: Rect[] = []
      const onScreen: { s: WaypointSymbol; sx: number; sy: number }[] = []
      for (const s of ordered) {
        const p = map.project([s.lon, s.lat])
        if (p.x < -40 || p.y < -40 || p.x > vw + 40 || p.y > vh + 40) continue
        onScreen.push({ s, sx: p.x, sy: p.y })
        iconRects.push({ x: p.x - 14, y: p.y - 14, w: 28, h: 28 })
      }

      const labelRects: Rect[] = []
      const next: Placement[] = []
      for (const { s, sx, sy } of onScreen) {
        const gap = s.gsFaf ? 44 : 16
        const { w, h } = labelBoxSize(s)
        const cands: Pt[] = [
          { x: gap, y: -h / 2 }, { x: -gap - w, y: -h / 2 },
          { x: gap, y: -gap - h }, { x: -gap - w, y: -gap - h },
          { x: gap, y: gap }, { x: -gap - w, y: gap },
          { x: -w / 2, y: -gap - h }, { x: -w / 2, y: gap },
        ]
        const c = place(sx, sy, cands, w, h, iconRects, labelRects, vw, vh, allowOverlap)
        if (!c) continue
        labelRects.push({ x: sx + c.x, y: sy + c.y, w, h })
        next.push({ s, dx: c.x, dy: c.y, w, h, placed: true })
      }
      setPlacements(next)

      // ── Segment distance labels (approach, zoom ≥ threshold) ─────────────
      if (zoom < SEG_LABEL_MIN_ZOOM) {
        setSegmentLabels([])
        return
      }

      const segLabels: SegLabel[] = []
      for (const proc of procedures) {
        if (proc.type !== 'APPROACH') continue

        // Build set of fix IDs that carry a DME annotation — those segments are
        // handled by the D-badge at the fix, so no midpoint label is needed.
        const dmeFixIds = new Set(
          proc.symbols.filter((s) => (s.dmeNm ?? null) !== null).map((s) => s.id),
        )

        const wpts = proc.waypoints
        for (let i = 0; i < wpts.length - 1; i++) {
          const a = wpts[i]
          const b = wpts[i + 1]
          // Skip when either endpoint already has a DME badge.
          if (dmeFixIds.has(a.id) || dmeFixIds.has(b.id)) continue

          const pt1 = turf.point([a.lon, a.lat])
          const pt2 = turf.point([b.lon, b.lat])
          const distNm = turf.distance(pt1, pt2, { units: 'nauticalmiles' })
          if (distNm < SEG_LABEL_MIN_NM) continue

          // Place the label 0.25 nm perpendicular to the right of the track.
          const bearing = turf.bearing(pt1, pt2)
          const perpBearing = (bearing + 90 + 360) % 360
          const mid = turf.midpoint(pt1, pt2)
          const offsetPt = turf.destination(mid, SEG_OFFSET_NM, perpBearing, { units: 'nauticalmiles' })
          const [lon, lat] = offsetPt.geometry.coordinates

          // Skip if off-screen.
          const p = map.project([lon, lat])
          if (p.x < -20 || p.y < -20 || p.x > vw + 20 || p.y > vh + 20) continue

          segLabels.push({
            key: `${proc.id}-seg-${i}`,
            lon,
            lat,
            text: distNm.toFixed(1),
            color: proc.color,
          })
        }
      }
      setSegmentLabels(segLabels)
    }

    const schedule = () => {
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        recompute()
      })
    }

    recompute()
    map.on('moveend', schedule)
    return () => {
      map.off('moveend', schedule)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [mapRef, symbols, procedures])

  return (
    <>
      {placements.map((pl) => {
        const { s, dx, dy, w, h } = pl
        const altC: AltConstraint | null = !s.alt
          ? null
          : s.gsFaf
            ? { type: 'AT_OR_ABOVE', low: s.alt.low }
            : s.alt
        const boltFrom = s.gsFaf ? nearestPointToFix(dx, dy, w, h) : null
        const dme = s.dmeNm ?? null

        return (
          <Marker key={symKey(s)} longitude={s.lon} latitude={s.lat} anchor="center">
            <div className={styles.container}>
              <div className={styles.icon}>
                <WpIcon s={s} />
              </div>

              {boltFrom && <BoltArrow from={boltFrom} to={{ x: 0, y: 0 }} />}

              <div className={styles.label} style={{ transform: `translate(${dx}px, ${dy}px)` }}>
                {/* Name line: fix ID + optional DME D-badge to the right */}
                <div className={styles.nameRow}>
                  <span className={styles.name}>{s.id}</span>
                  {dme !== null && <DmeBadge nm={dme} />}
                </div>
                {(altC || s.speedKt) && (
                  <div className={styles.restrictions}>
                    {altC && <AltLabel c={altC} />}
                    {s.speedKt ? <SpeedLabel kt={s.speedKt} /> : null}
                  </div>
                )}
              </div>
            </div>
          </Marker>
        )
      })}

      {segmentLabels.map((sl) => (
        <Marker key={sl.key} longitude={sl.lon} latitude={sl.lat} anchor="center">
          <div className={styles.segDist} style={{ color: sl.color }}>
            {sl.text}
          </div>
        </Marker>
      ))}
    </>
  )
}
