import { useEffect, useMemo, useRef, useState } from 'react'
import * as turf from '@turf/turf'
import { Marker, useMap } from 'react-map-gl'
import type { Procedure, WaypointSymbol, AltConstraint } from '../../types/procedure'
import { BoltGlyph, DmeD, dmeGlyphWidth, MALTESE_PATH, MarkerLens, type Pt } from './glyphs'
import {
  groupCourseLabels,
  labelRotation,
  padCourse,
  type CourseLeg,
} from '../../geo/segmentCourseLabels'
import {
  procedureTurnDrawnLengthNm,
  holdOutboundLabelAnchor,
  holdInboundLabelAnchor,
  PT_BARB_NM,
} from '../../geo/procedureShapes'
import { magneticToTrue } from '../../utils/arincRecords'
import styles from './WaypointMarkers.module.css'

const norm360 = (d: number): number => ((d % 360) + 360) % 360

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

const ROLE_RANK: Record<string, number> = { map: 6, faf: 5, iaf: 4, if: 3, hold: 2, normal: 1 }

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

// Rotated magnetic-course label placed along an approach segment.
interface CourseLabelPlacement {
  key: string
  lon: number
  lat: number
  text: string
  color: string
  rot: number
  flipped: boolean
}

// A short rotated course label drawn along a shape leg (procedure-turn barb
// tick, hold straight legs). `text` already carries the degree sign / arrow;
// `alt` is an optional constraint rendered under the text (a hold's own
// crossing restriction, shown only when it differs from the fix's).
interface LegCourseLabel {
  key: string
  lon: number
  lat: number
  text: string
  color: string
  rot: number
  flipped: boolean
  alt?: AltConstraint | null
}

export function WaypointMarkers({ procedures }: Props) {
  const { current: mapRef } = useMap()
  const [placements, setPlacements] = useState<Placement[]>([])
  const [segmentLabels, setSegmentLabels] = useState<SegLabel[]>([])
  const [courseLabels, setCourseLabels] = useState<CourseLabelPlacement[]>([])
  const [barbLabels, setBarbLabels] = useState<LegCourseLabel[]>([])
  const [holdLabels, setHoldLabels] = useState<LegCourseLabel[]>([])
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

  // symKeys that belong to an APPROACH — drives IAF/IF label tags (task 6),
  // which are meaningful only on approaches.
  const approachSymKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const proc of procedures) {
      if (proc.type !== 'APPROACH') continue
      for (const s of proc.symbols) keys.add(symKey(s))
    }
    return keys
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
        // Marker fixes carry the wide LOM lens, so reserve a wider footprint
        // than the default icon so neighbouring labels keep clear of it.
        const iw = s.marker ? 60 : 28
        const ih = s.marker ? 34 : 28
        iconRects.push({ x: p.x - iw / 2, y: p.y - ih / 2, w: iw, h: ih })
      }

      const labelRects: Rect[] = []
      const next: Placement[] = []
      for (const { s, sx, sy } of onScreen) {
        // Marker fixes need extra lateral gap to clear the wide LOM lens.
        const gap = s.marker ? 34 : s.gsFaf ? 44 : 16
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

      const mapBearing = map.getBearing()

      // ── Segment distance labels (zoom ≥ threshold) ────────────────────────
      if (zoom < SEG_LABEL_MIN_ZOOM) {
        setSegmentLabels([])
        setCourseLabels([])
        setBarbLabels([])
        setHoldLabels([])
        return
      }

      // Suppress a label whose screen anchor sits within `pad` px of any fix/
      // navaid icon rect (reuse the placement pass's iconRects).
      const nearIcon = (px: number, py: number, pad = 28) =>
        iconRects.some(
          (r) => px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad,
        )

      const segLabels: SegLabel[] = []
      for (const proc of procedures) {
        // Distance labels follow the representative (longest) transition — but
        // only its inbound path up to and including the MAP. FAA plan views don't
        // label missed-approach leg distances, and the missed leg runs back down
        // the final corridor, so labeling it duplicates the final leg's distance
        // (e.g. KAWO's "4.7" appearing twice). Fall back to raw waypoints for
        // legacy data with no transitions.
        let wpts: Array<{ lat: number; lon: number }>
        if (proc.transitions && proc.transitions.length > 0) {
          const rep = proc.transitions.reduce((a, b) => (b.legs.length > a.legs.length ? b : a))
          const mapIdx = rep.legs.findIndex((l) => l.role === 'map')
          const endIdx = mapIdx >= 0 ? mapIdx + 1 : rep.legs.length
          wpts = rep.legs.slice(0, endIdx)
        } else {
          wpts = proc.waypoints
        }
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

      // ── Procedure-turn barb heading labels (approaches with a course reversal) ──
      // FAA plan view labels the barb tick with the barb course on the outer
      // (tip) side and its reciprocal on the inner side. The final course itself
      // is labeled by the segment-course pass below (just its inbound course), so
      // no outbound/inbound text pair sits on the final line any more.
      const bLabels: LegCourseLabel[] = []
      const onScreenLabel = (lon: number, lat: number): boolean => {
        const p = map.project([lon, lat])
        return !(p.x < -20 || p.y < -20 || p.x > vw + 20 || p.y > vh + 20)
      }
      for (const proc of procedures) {
        const cr = proc.courseReversal
        if (proc.type !== 'APPROACH' || !cr) continue
        // PI fix coordinates, plus the collocated FAF (the barb is anchored on
        // the final path when they coincide — matching the worker's geometry).
        let fix: { lat: number; lon: number } | null = null
        let faf: { lat: number; lon: number } | null = null
        for (const t of proc.transitions ?? []) {
          if (!fix) {
            const leg = t.legs.find((l) => l.fixId === cr.fixId)
            if (leg) fix = { lat: leg.lat, lon: leg.lon }
          }
          if (!faf) {
            const fl = t.legs.find((l) => l.role === 'faf')
            if (fl && t.legs.some((l) => l.role === 'map')) faf = { lat: fl.lat, lon: fl.lon }
          }
        }
        if (!fix) continue
        const anchor =
          faf && turf.distance(turf.point([fix.lon, fix.lat]), turf.point([faf.lon, faf.lat]), {
            units: 'nauticalmiles',
          }) <= 0.5
            ? faf
            : fix

        const magVar = proc.magVarDeg ?? 0
        const outboundTrue = magneticToTrue(cr.outboundCourseMag, magVar)
        const barbCourseMag = norm360(cr.outboundCourseMag + (cr.turnRight ? -45 : 45))
        const barbTrue = magneticToTrue(barbCourseMag, magVar)
        const drawnLen = procedureTurnDrawnLengthNm(cr.limitNm)
        const end = turf.destination(turf.point([anchor.lon, anchor.lat]), drawnLen, outboundTrue, {
          units: 'nauticalmiles',
        })
        const { rot, flipped } = labelRotation(barbTrue, mapBearing)
        // Outer label (barb course) near the tip, reciprocal near the leg.
        const spots: Array<{ frac: number; text: string; tag: string }> = [
          { frac: 0.8, text: `${padCourse(barbCourseMag)}°`, tag: 'out' },
          { frac: 0.28, text: `${padCourse(barbCourseMag + 180)}°`, tag: 'in' },
        ]
        for (const s of spots) {
          const pos = turf.destination(end, PT_BARB_NM * s.frac, barbTrue, { units: 'nauticalmiles' })
          const [lon, lat] = pos.geometry.coordinates
          if (!onScreenLabel(lon, lat)) continue
          bLabels.push({ key: `${proc.id}-barb-${s.tag}`, lon, lat, text: s.text, color: proc.color, rot, flipped })
        }
      }
      setBarbLabels(bLabels)

      // ── Hold course labels (racetracks) ───────────────────────────────────
      // Label BOTH straight legs of each hold with their magnetic course + a
      // travel-direction arrow, rotated along the leg — pilots expect the
      // inbound course printed even when it matches the final approach course
      // (plates always show both). The hold's own altitude constraint rides
      // under the outbound label when it adds information (differs from the
      // fix's charted restriction).
      const hLabels: LegCourseLabel[] = []
      for (const proc of procedures) {
        const magVar = proc.magVarDeg ?? 0
        for (const f of proc.geojson.features) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const props = (f as any).properties
          if (!props || props.kind !== 'hold') continue
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const coords = (f as any).geometry?.coordinates as [number, number][] | undefined
          if (!coords || coords.length < 2) continue
          const A = coords[0]
          const F = coords[1] // holdTrack emits [A, fix, …]
          const inboundMag: number = props.inboundCourseMag ?? 0
          const turnRight: boolean = props.turnRight !== false
          const legNm = turf.distance(turf.point(A), turf.point(F), { units: 'nauticalmiles' })
          const inboundTrue = magneticToTrue(inboundMag, magVar)

          // Hold crossing restriction — shown only when it differs from the
          // fix symbol's own (else it would just duplicate the fix label).
          const holdAlt: AltConstraint | null = props.alt ?? null
          const fixAlt = proc.symbols.find((s) => s.id === props.fixId)?.alt ?? null
          const altDiffers = holdAlt != null && JSON.stringify(holdAlt) !== JSON.stringify(fixAlt)

          const legAnchors = [
            { ...holdOutboundLabelAnchor(F[1], F[0], inboundTrue, turnRight, legNm), mag: norm360(inboundMag + 180), tag: 'out' },
            { ...holdInboundLabelAnchor(F[1], F[0], inboundTrue, legNm), mag: inboundMag, tag: 'in' },
          ]
          for (const a of legAnchors) {
            if (!onScreenLabel(a.lon, a.lat)) continue
            const { rot, flipped } = labelRotation(a.courseTrue, mapBearing)
            const text = flipped ? `← ${padCourse(a.mag)}°` : `${padCourse(a.mag)}° →`
            hLabels.push({
              key: `${proc.id}-${props.fixId ?? ''}-hold-${a.tag}`,
              lon: a.lon,
              lat: a.lat,
              text,
              color: proc.color,
              rot,
              flipped,
              alt: a.tag === 'out' && altDiffers ? holdAlt : null,
            })
          }
        }
      }
      setHoldLabels(hLabels)

      // ── Segment magnetic-course labels (approaches only) ──────────────────
      const cLabels: CourseLabelPlacement[] = []
      const seenCourse = new Set<string>()
      for (const proc of procedures) {
        if (proc.type !== 'APPROACH' || !proc.transitions) continue
        const magVar = proc.magVarDeg ?? 0
        for (const t of proc.transitions) {
          const legs: CourseLeg[] = t.legs.map((l) => ({
            lat: l.lat,
            lon: l.lon,
            course: l.course,
            pathTerm: l.pathTerm,
            role: l.role,
          }))
          for (const label of groupCourseLabels(legs, magVar, !!t.noPt)) {
            // Dedup shared segments (e.g. the common final appears once, but
            // enroute transitions can repeat a joined leg).
            const dk = `${label.lat.toFixed(3)}:${label.lon.toFixed(3)}:${label.text}:${label.noPt}`
            if (seenCourse.has(dk)) continue
            seenCourse.add(dk)

            const p = map.project([label.lon, label.lat])
            if (p.x < -20 || p.y < -20 || p.x > vw + 20 || p.y > vh + 20) continue
            if (nearIcon(p.x, p.y)) continue

            const { rot, flipped } = labelRotation(label.trueBearing, mapBearing)
            cLabels.push({
              key: `${proc.id}-crs-${dk}`,
              lon: label.lon,
              lat: label.lat,
              text: label.noPt ? `${label.text}° NoPT` : `${label.text}°`,
              color: proc.color,
              rot,
              flipped,
            })
          }
        }
      }
      setCourseLabels(cLabels)
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
        // IAF/IF/FAF chip — approaches only.
        const roleTag =
          approachSymKeys.has(symKey(s)) && (s.role === 'iaf' || s.role === 'if' || s.role === 'faf')
            ? s.role.toUpperCase()
            : null

        return (
          <Marker key={symKey(s)} longitude={s.lon} latitude={s.lat} anchor="center">
            <div className={styles.container}>
              {s.isDmeSource && <div className={styles.dmeRing} />}
              {/* Marker beacon (LOM etc.) — lens + NDB overlay centered on the
                  fix (it coincides with the collocated locator); drawn before
                  the fix icon so the FAF glyph sits on top of it. */}
              {s.marker && (
                <div className={styles.markerLens}>
                  <MarkerLens locator={s.markerLocator} />
                </div>
              )}

              <div className={styles.icon}>
                <WpIcon s={s} />
              </div>

              {/* Marker type label below the fix — 'LOM' for a locator. */}
              {s.marker && (
                <span className={styles.markerLabel}>
                  {s.markerLocator ? `L${s.marker}` : s.marker}
                </span>
              )}

              {boltFrom && <BoltGlyph from={boltFrom} to={{ x: 0, y: 0 }} className={styles.bolt} />}

              <div className={styles.label} style={{ transform: `translate(${dx}px, ${dy}px)` }}>
                {/* Name line: fix ID + optional DME D-badge to the right */}
                <div className={styles.nameRow}>
                  <span className={styles.name}>{s.id}</span>
                  {roleTag && <span className={styles.roleTag}>{roleTag}</span>}
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

      {/* Magnetic-course labels along approach segments (task 4/5). Rotated to
          align with the leg; nudged to a consistent screen side so they clear
          the line. */}
      {courseLabels.map((cl) => (
        <Marker key={cl.key} longitude={cl.lon} latitude={cl.lat} anchor="center">
          <div
            className={styles.courseLabel}
            style={{ color: cl.color, transform: `rotate(${cl.rot}deg) translateY(${cl.flipped ? 9 : -9}px)` }}
          >
            {cl.text}
          </div>
        </Marker>
      ))}

      {/* Procedure-turn barb heading labels: barb course on the tip side, its
          reciprocal on the inner side, each rotated along the 45° tick. */}
      {barbLabels.map((bl) => (
        <Marker key={bl.key} longitude={bl.lon} latitude={bl.lat} anchor="center">
          <div
            className={styles.barbLabel}
            style={{ color: bl.color, transform: `rotate(${bl.rot}deg) translateY(${bl.flipped ? 8 : -8}px)` }}
          >
            {bl.text}
          </div>
        </Marker>
      ))}

      {/* Hold course labels: magnetic course + travel arrow on BOTH straight
          legs of the racetrack, each rotated along its leg. The hold's own
          altitude restriction (when it differs from the fix's) rides under
          the outbound label. */}
      {holdLabels.map((hl) => (
        <Marker key={hl.key} longitude={hl.lon} latitude={hl.lat} anchor="center">
          <div
            className={styles.holdCourseLabel}
            style={{ color: hl.color, transform: `rotate(${hl.rot}deg) translateY(${hl.flipped ? 10 : -10}px)` }}
          >
            <span className={styles.courseLabel} style={{ color: hl.color }}>{hl.text}</span>
            {hl.alt && <AltLabel c={hl.alt} />}
          </div>
        </Marker>
      ))}
    </>
  )
}
