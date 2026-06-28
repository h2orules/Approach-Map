import { useEffect, useMemo, useRef, useState } from 'react'
import { Marker, useMap } from 'react-map-gl'
import type { Procedure, WaypointSymbol, AltConstraint } from '../../types/procedure'
import styles from './WaypointMarkers.module.css'

interface Props {
  procedures: Procedure[]
}

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
  return (
    <div className={styles.spd}>
      <span className={styles.barAbove}>{kt}</span>Kt
    </div>
  )
}

// Lightning bolt pointing up-right toward the FAF (glideslope intercept).
function GsBolt() {
  return (
    <svg width={30} height={26} viewBox="0 0 30 26" className={styles.bolt}>
      <path d="M2 24 L14 12 L10 12 L20 2 L16 9 L21 9 L9 22 L12 16 Z"
        fill="#fcd34d" stroke="#0b0f14" strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  )
}

// ---- placement -----------------------------------------------------------
interface Placement {
  s: WaypointSymbol
  dx: number
  dy: number
}

interface Rect { x: number; y: number; w: number; h: number }
const hit = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

// Rough label box estimate (px), good enough to drive collision avoidance.
function estimateSize(s: WaypointSymbol): { w: number; h: number } {
  if (s.gsFaf) return { w: 46, h: 34 } // bolt + intercept altitude
  let lines = 1 // name
  let maxChars = s.id.length
  if (s.alt) {
    lines += s.alt.type === 'BETWEEN' ? 2 : 1
    maxChars = Math.max(maxChars, 6)
  }
  if (s.speedKt) {
    lines += 1
    maxChars = Math.max(maxChars, 5)
  }
  return { w: maxChars * 8.4 + 6, h: lines * 14 + 6 }
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

      // Place important symbols first so they win the prime positions.
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
        // Candidate label corners relative to the fix. gsFaf prefers lower-left
        // (bolt rises toward the fix); others prefer the right side.
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
          if (zoom < DROP_ZOOM) continue // drop only when zoomed way out
          chosen = cands[0] // show anyway, accepting overlap
        }
        occupied.push({ x: sx + chosen.x, y: sy + chosen.y, w, h })
        next.push({ s, dx: chosen.x, dy: chosen.y })
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

    // Recompute placements when the view settles (markers themselves follow the
    // map continuously via their own projection, so per-frame work isn't needed).
    recompute()
    map.on('moveend', schedule)
    return () => {
      map.off('moveend', schedule)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [mapRef, symbols])

  return (
    <>
      {placements.map(({ s, dx, dy }) => (
        <Marker key={symKey(s)} longitude={s.lon} latitude={s.lat} anchor="center">
          <div className={styles.container}>
            <div className={styles.icon}>
              <WpIcon s={s} />
            </div>
            <div className={styles.label} style={{ transform: `translate(${dx}px, ${dy}px)` }}>
              {s.gsFaf ? (
                <div className={styles.gsBlock}>
                  <GsBolt />
                  {s.alt && <AltLabel c={s.alt} />}
                </div>
              ) : (
                <>
                  <div className={styles.name}>{s.id}</div>
                  {s.alt && <AltLabel c={s.alt} />}
                  {s.speedKt ? <SpeedLabel kt={s.speedKt} /> : null}
                </>
              )}
            </div>
          </div>
        </Marker>
      ))}
    </>
  )
}
