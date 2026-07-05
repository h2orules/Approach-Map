import { useEffect, useMemo, useRef, useState } from 'react'
import * as turf from '@turf/turf'
import { Marker, useMap } from 'react-map-gl'
import type { Procedure, WaypointSymbol, AltConstraint } from '../../types/procedure'
import { BoltGlyph, DmeD, dmeGlyphWidth, MALTESE_PATH, type Pt } from './glyphs'
import styles from './WaypointMarkers.module.css'

interface Props {
  procedures: Procedure[]
}

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
    // Maltese cross (cross patée), 45°-rotated — the same FAF symbol the
    // vertical profile draws (shared MALTESE_PATH in glyphs.tsx).
    return (
      <svg width={size} height={size} viewBox="0 0 26 26">
        {fo && <Ring cx={13} cy={13} r={12} color="#f0abfc" />}
        <path d={MALTESE_PATH} transform="translate(13 13) rotate(45) scale(1.3)" fill="#f0abfc" {...halo} />
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
  if (s.navaidType === 'LOC') {
    // Localizer (ILS DME reference) — narrow diamond with a center dot.
    return (
      <svg width={size} height={size} viewBox="0 0 24 24">
        {fo && <Ring cx={12} cy={12} r={11} color="#c4b5fd" />}
        <path d="M12 3 L16 12 L12 21 L8 12 Z" fill="none" stroke="#c4b5fd" strokeWidth={2} strokeLinejoin="round" />
        <circle cx="12" cy="12" r="1.8" fill="#c4b5fd" />
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
  const dmeExtra = dme !== null ? 4 + dmeGlyphWidth(dme) : 0 // 4px gap before badge
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

      // ── Segment distance labels (zoom ≥ threshold) ────────────────────────
      if (zoom < SEG_LABEL_MIN_ZOOM) {
        setSegmentLabels([])
        return
      }

      const segLabels: SegLabel[] = []
      for (const proc of procedures) {
        const wpts = proc.waypoints
        for (let i = 0; i < wpts.length - 1; i++) {
          const a = wpts[i]
          const b = wpts[i + 1]

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
              {s.isDmeSource && <div className={styles.dmeRing} />}
              <div className={styles.icon}>
                <WpIcon s={s} />
              </div>

              {boltFrom && <BoltGlyph from={boltFrom} to={{ x: 0, y: 0 }} className={styles.bolt} />}

              <div className={styles.label} style={{ transform: `translate(${dx}px, ${dy}px)` }}>
                {/* Name line: fix ID + optional DME D-badge to the right */}
                <div className={styles.nameRow}>
                  <span className={styles.name}>{s.id}</span>
                  {dme !== null && (
                    <span className={styles.dmeBadge}>
                      {s.dmeNavaid && <span className={styles.dmeIdent}>{s.dmeNavaid}</span>}
                      <DmeD nm={dme} />
                    </span>
                  )}
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
