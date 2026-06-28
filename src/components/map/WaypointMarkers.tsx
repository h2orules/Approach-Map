import { useEffect, useMemo, useRef, useState } from 'react'
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

function symKey(s: WaypointSymbol): string {
  return `${s.id}:${s.lat.toFixed(4)}:${s.lon.toFixed(4)}`
}

const ROLE_RANK: Record<string, number> = { map: 5, faf: 4, iaf: 3, hold: 2, normal: 1 }

// ---- icons ---------------------------------------------------------------
function WpIcon({ s, size = 26 }: { s: WaypointSymbol; size?: number }) {
  const halo = { stroke: '#0b0f14', strokeWidth: 1.6, strokeLinejoin: 'round' as const }
  if (s.role === 'faf' && !s.gsFaf) {
    return (
      <svg width={size} height={size} viewBox="0 0 26 26">
        <path d="M13 2 L15.6 8 L13 10.2 L10.4 8 Z M13 24 L15.6 18 L13 15.8 L10.4 18 Z M2 13 L8 10.4 L10.2 13 L8 15.6 Z M24 13 L18 10.4 L15.8 13 L18 15.6 Z" fill="#f0abfc" {...halo} />
      </svg>
    )
  }
  if (s.role === 'map' || s.navaidType === 'RUNWAY') {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20">
        <rect x="5" y="5" width="10" height="10" fill="#86efac" {...halo} />
      </svg>
    )
  }
  if (s.navaidType === 'VOR' || s.navaidType === 'VORTAC') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path d="M12 3 L20 7.5 L20 16.5 L12 21 L4 16.5 L4 7.5 Z" fill="none" stroke="#7dd3fc" strokeWidth={2.2} />
        <circle cx="12" cy="12" r="2" fill="#7dd3fc" />
      </svg>
    )
  }
  if (s.navaidType === 'NDB') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" fill="none" stroke="#fbbf24" strokeWidth={1.6} strokeDasharray="1.5 2.2" />
        <circle cx="12" cy="12" r="2.4" fill="#fbbf24" {...halo} />
      </svg>
    )
  }
  // default fix — solid triangle
  return (
    <svg width={size} height={size} viewBox="0 0 22 22">
      <path d="M11 4 L18 17 L4 17 Z" fill="#cbd5e1" {...halo} />
    </svg>
  )
}

// ---- restriction labels --------------------------------------------------
function AltLabel({ c }: { c: AltConstraint }) {
  const f = (n: number) => n.toLocaleString('en-US')
  if (c.type === 'BETWEEN') {
    return (
      <div className={styles.alt}>
        <span className={styles.barAbove}>{f(c.high ?? c.low)}</span>
        <span className={styles.barBelow}>{f(c.low)}</span>
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
      <span className={cls}>{f(val)}</span>
    </div>
  )
}

function SpeedLabel({ kt }: { kt: number }) {
  // Procedure speeds are maxima → bar above, spanning the whole "###Kt".
  return (
    <div className={styles.spd}>
      <span className={styles.barAbove}>{kt}Kt</span>
    </div>
  )
}

interface Pt { x: number; y: number }

// Hand-drawn zig-zag lightning arrow: starts (no tail) near `from`, kinks toward
// `to`, and ends in a filled triangle pointing at the fix. Container px coords.
function BoltArrow({ from, to }: { from: Pt; to: Pt }) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux
  const amp = Math.min(Math.max(len * 0.16, 3), 7)
  const headLen = 9
  const headW = 5

  const p0 = from
  const p1 = { x: from.x + ux * len * 0.35 + px * amp, y: from.y + uy * len * 0.35 + py * amp }
  const p2 = { x: from.x + ux * len * 0.7 - px * amp, y: from.y + uy * len * 0.7 - py * amp }
  const base = { x: to.x - ux * headLen, y: to.y - uy * headLen }

  const pad = 4
  const xs = [p0.x, p1.x, p2.x, to.x, base.x + px * headW, base.x - px * headW]
  const ys = [p0.y, p1.y, p2.y, to.y, base.y + py * headW, base.y - py * headW]
  const minX = Math.min(...xs) - pad
  const minY = Math.min(...ys) - pad
  const w = Math.max(...xs) - minX + pad
  const h = Math.max(...ys) - minY + pad
  const L = (p: Pt) => `${p.x - minX},${p.y - minY}`

  return (
    <svg
      className={styles.bolt}
      style={{ left: minX, top: minY, width: w, height: h }}
      width={w}
      height={h}
    >
      <polyline
        points={`${L(p0)} ${L(p1)} ${L(p2)} ${L(base)}`}
        fill="none"
        stroke={RESTRICTION_COLOR}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <polygon
        points={`${L(to)} ${L({ x: base.x + px * headW, y: base.y + py * headW })} ${L({ x: base.x - px * headW, y: base.y - py * headW })}`}
        fill={RESTRICTION_COLOR}
        stroke="#0b0f14"
        strokeWidth={0.6}
      />
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
}

interface Rect { x: number; y: number; w: number; h: number }
const hit = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

// Rough label box estimate (px), good enough to drive collision avoidance.
function estimateSize(s: WaypointSymbol): { w: number; h: number } {
  if (s.gsFaf) return { w: 52, h: 22 } // intercept altitude (bolt drawn separately)
  const between = s.alt?.type === 'BETWEEN'
  const altChars = s.alt ? 6 : 0
  const spdChars = s.speedKt ? 5 : 0
  const rowChars = altChars + (s.speedKt ? 1 + spdChars : 0)
  const maxChars = Math.max(s.id.length, rowChars)
  const rowLines = between ? 2 : s.alt || s.speedKt ? 1 : 0
  return { w: maxChars * 8.4 + 6, h: (1 + rowLines) * 15 + 6 }
}

// Pick the corner of a label box closest to the fix at the origin.
function nearestCorner(dx: number, dy: number, w: number, h: number): Pt {
  const corners = [
    { x: dx, y: dy },
    { x: dx + w, y: dy },
    { x: dx, y: dy + h },
    { x: dx + w, y: dy + h },
  ]
  return corners.reduce((a, b) => (a.x * a.x + a.y * a.y <= b.x * b.x + b.y * b.y ? a : b))
}

export function WaypointMarkers({ procedures }: Props) {
  const { current: mapRef } = useMap()
  const [placements, setPlacements] = useState<Placement[]>([])
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
      const gap = 16

      const ordered = [...symbols].sort((a, b) => (ROLE_RANK[b.role] ?? 0) - (ROLE_RANK[a.role] ?? 0))

      const occupied: Rect[] = []
      const onScreen: { s: WaypointSymbol; sx: number; sy: number }[] = []
      for (const s of ordered) {
        const p = map.project([s.lon, s.lat])
        if (p.x < -40 || p.y < -40 || p.x > vw + 40 || p.y > vh + 40) continue
        onScreen.push({ s, sx: p.x, sy: p.y })
        occupied.push({ x: p.x - 13, y: p.y - 13, w: 26, h: 26 }) // reserve the icon
      }

      const next: Placement[] = []
      for (const { s, sx, sy } of onScreen) {
        const { w, h } = estimateSize(s)
        const cands = s.gsFaf
          ? [
              { x: -gap - w, y: gap }, { x: -gap - w, y: -h / 2 }, { x: -gap - w, y: -gap - h },
              { x: gap, y: gap }, { x: -w / 2, y: gap },
            ]
          : [
              { x: gap, y: -h / 2 }, { x: -gap - w, y: -h / 2 },
              { x: gap, y: -gap - h }, { x: -gap - w, y: -gap - h },
              { x: gap, y: gap }, { x: -gap - w, y: gap },
              { x: -w / 2, y: -gap - h }, { x: -w / 2, y: gap },
            ]

        let chosen: { x: number; y: number } | null = null
        for (const c of cands) {
          const r: Rect = { x: sx + c.x, y: sy + c.y, w, h }
          if (r.x < 2 || r.y < 2 || r.x + r.w > vw - 2 || r.y + r.h > vh - 2) continue
          if (occupied.some((o) => hit(o, r))) continue
          chosen = c
          break
        }
        if (!chosen) {
          if (zoom < DROP_ZOOM) continue
          chosen = cands[0]
        }
        occupied.push({ x: sx + chosen.x, y: sy + chosen.y, w, h })
        next.push({ s, dx: chosen.x, dy: chosen.y, w, h })
      }
      setPlacements(next)
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
  }, [mapRef, symbols])

  return (
    <>
      {placements.map(({ s, dx, dy, w, h }) => {
        const gsAlt: AltConstraint | null = s.gsFaf && s.alt ? { type: 'AT_OR_ABOVE', low: s.alt.low } : null
        const boltFrom = s.gsFaf ? nearestCorner(dx, dy, w, h) : null
        return (
          <Marker key={symKey(s)} longitude={s.lon} latitude={s.lat} anchor="center">
            <div className={styles.container}>
              <div className={styles.icon}>
                <WpIcon s={s} />
              </div>
              {boltFrom && <BoltArrow from={boltFrom} to={{ x: 0, y: 0 }} />}
              <div className={styles.label} style={{ transform: `translate(${dx}px, ${dy}px)` }}>
                {s.gsFaf ? (
                  gsAlt && <AltLabel c={gsAlt} />
                ) : (
                  <>
                    <div className={styles.name}>{s.id}</div>
                    {(s.alt || s.speedKt) && (
                      <div className={styles.restrictions}>
                        {s.alt && <AltLabel c={s.alt} />}
                        {s.speedKt ? <SpeedLabel kt={s.speedKt} /> : null}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </Marker>
        )
      })}
    </>
  )
}
