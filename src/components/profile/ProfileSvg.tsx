import { memo } from 'react'
import type { AltConstraint } from '../../types/procedure'
import { BoltGlyph, DmeD, dmeGlyphWidth } from '../map/glyphs'
import {
  descentProfilePoints,
  fixRenderAltitudes,
  segmentDistancesNm,
  labelStaggerOffsets,
  placeProfileLabels,
} from '../../geo/profileMath'
import type { ProfileFix, ProfileModel, LiveAircraft } from '../../geo/profileMath'
import styles from './ProfileSvg.module.css'

interface Props {
  model: ProfileModel
  liveAircraft?: LiveAircraft[]
  width: number
  height: number
}

// ── layout constants (module-local — do not confuse with config/constants.ts) ──
const MARGIN = { top: 4, right: 20, bottom: 4, left: 16 }
const TOP_BAND_H = 64 // fix names + DME boxes, staggered following the descent
const BOTTOM_BAND_H = 26 // inter-fix distance scale
const NAME_TOP_PAD = 14 // px from the top of the band to the highest fix's label baseline
const LABEL_STAGGER_MAX = 26 // px the label baseline steps down inside the top band
const DME_ROW_GAP = 15 // px from the name baseline down to the DME ident/glyph row
const DME_SCALE = 0.92 // scale the shared DmeD glyph to fit the label band
const WEDGE_HALF_WIDTH_PX = 15 // 34:1 clear-surface wedge half-height at the FAF end
const WEDGE_TIP_HALF_WIDTH_PX = 3 // half-height at the threshold end (not a perfect point — stays visible)
const WEDGE_NOTCH_PX = 7 // forked-tail notch depth, cut into the wide (FAF) end
const X_INSET_LEFT = 34 // horizontal room inside the left margin so the first fix label (name + speed) doesn't clip
const X_INSET_RIGHT = 76 // larger right inset: the last fix's label PLUS the TDZE note (which sits past the threshold) must fit — keeps the drawn profile visually centered
const ALT_HEADROOM = 30 // vertical room above the highest fix so its altitude label clears the name band
const ALT_CHAR_W = 7 // px per char of an altitude label at 11.5px Roboto Mono — sizes the over/under bars to the text
const ALT_CY_OFFSET = 17 // px the altitude label's vertical center sits above the fix point
const ALT_BAR_HALF_GAP = 7.5 // px from the altitude label center up/down to each over/under bar
// Lightning-bolt geometry, relative to the FAF/GS-intercept fix: the arrowhead
// lands on the fix (0,0) and the tail sits up and to the right. The altitude
// restriction is placed at the tail (see AltAnnotation / ProfileBolt).
const GS_BOLT_TAIL = { dx: 18, dy: -22 }
const GS_ALT_GAP = 6 // px between the bolt tail and the near edge of the altitude label
const NAME_CHAR_W = 7.6 // px per char of a fix name at 12px bold Roboto Mono — for label de-collision
const NAME_ROW_H = 15 // px a colliding fix name is pushed down to the next row
const AIRCRAFT_LABEL_ABOVE_DY = -10 // px from the glyph center to the label baseline, above
const AIRCRAFT_LABEL_BELOW_DY = 17 // px from the glyph center to the label baseline, below

// ── scales ──────────────────────────────────────────────────────────────

function computeYDomain(model: ProfileModel): [number, number] {
  // Approach fixes only — the missed approach is no longer plotted, so its
  // (often much higher) altitudes must not stretch the vertical scale.
  const alts: number[] = []
  if (model.tdzeFt != null) alts.push(model.tdzeFt)
  for (const f of model.fixes) {
    if (f.plotAltFt != null) alts.push(f.plotAltFt)
  }
  if (alts.length === 0) alts.push(0, 3000)
  const lo = Math.min(...alts)
  const hi = Math.max(...alts)
  return [lo - 300, hi + 500]
}

interface PxPt {
  x: number
  y: number
}

/**
 * The FAA-plate "forked" 34:1 clear-surface wedge: wide at the FAF-crossing
 * point (anchor), narrowing toward the threshold, with a notch cut into the
 * wide end so the tail reads as forked rather than a flat edge.
 */
function buildWedgePath(anchor: PxPt, threshold: PxPt): string {
  const dx = threshold.x - anchor.x
  const dy = threshold.y - anchor.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux

  const hw = WEDGE_HALF_WIDTH_PX
  const tipHw = WEDGE_TIP_HALF_WIDTH_PX
  const notch = WEDGE_NOTCH_PX

  const topOuter = { x: anchor.x - ux * notch + px * hw, y: anchor.y - uy * notch + py * hw }
  const notchPt = { x: anchor.x + ux * notch, y: anchor.y + uy * notch }
  const bottomOuter = { x: anchor.x - ux * notch - px * hw, y: anchor.y - uy * notch - py * hw }
  const bottomTip = { x: threshold.x - px * tipHw, y: threshold.y - py * tipHw }
  const topTip = { x: threshold.x + px * tipHw, y: threshold.y + py * tipHw }

  const P = (p: PxPt) => `${p.x} ${p.y}`
  return `M ${P(topOuter)} L ${P(notchPt)} L ${P(bottomOuter)} L ${P(bottomTip)} L ${P(topTip)} Z`
}

// ── small presentational glyphs ────────────────────────────────────────

/**
 * Glideslope-intercept bolt, built on the shared map glyph. Comes down from the
 * upper-right tail (GS_BOLT_TAIL) and lands its arrowhead on the FAF /
 * GS-intercept fix itself (the actual intercept location); the altitude
 * restriction is drawn at the tail.
 */
function ProfileBolt({ x, y }: { x: number; y: number }) {
  return <BoltGlyph from={{ x: x + GS_BOLT_TAIL.dx, y: y + GS_BOLT_TAIL.dy }} to={{ x, y }} standalone={false} />
}

// A proper FAA "maltese cross" (cross patée): four arms narrow at the waist,
// flaring wide at the tips, each tip cut with a V-notch — not a plain plus.
const MALTESE_PATH = (() => {
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

function MalteseCross({ x, y }: { x: number; y: number }) {
  return (
    <g className={styles.malteseCross} transform={`translate(${x} ${y}) rotate(45)`}>
      <path d={MALTESE_PATH} />
    </g>
  )
}

function MapGlyph({ x, y }: { x: number; y: number }) {
  // Centered on the descent line at the runway/threshold altitude (not floating above it).
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={8} className={styles.mapGlyph} />
      <text className={styles.mapText} textAnchor="middle" dominantBaseline="central">M</text>
    </g>
  )
}

function HoldGlyph({ x, y, isPi }: { x: number; y: number; isPi: boolean }) {
  if (isPi) {
    // 45deg procedure-turn barb.
    return (
      <g transform={`translate(${x} ${y - 12})`} className={styles.holdGlyph}>
        <line x1={0} y1={0} x2={12} y2={0} />
        <line x1={12} y1={0} x2={8} y2={-6} />
      </g>
    )
  }
  // Simplified racetrack (hold) outline.
  return (
    <g transform={`translate(${x} ${y - 16})`} className={styles.holdGlyph}>
      <path d="M -8 0 A 4 4 0 0 1 -8 -8 H 8 A 4 4 0 0 1 8 0 Z" />
    </g>
  )
}

function AircraftGlyph({
  x,
  y,
  label,
  isSelected,
  labelAbove,
}: {
  x: number
  y: number
  label: string
  isSelected: boolean
  labelAbove: boolean
}) {
  const labelY = y + (labelAbove ? AIRCRAFT_LABEL_ABOVE_DY : AIRCRAFT_LABEL_BELOW_DY)
  // Feather points RIGHT with its tip at (x, y). The tip — not the body center —
  // is the reference point for both lateral (distance) and vertical (altitude)
  // position, so the body extends left from it. Label centers over the body.
  const points = `${x - 15},${y + 5} ${x},${y} ${x - 15},${y - 5} ${x - 11},${y}`
  return (
    <g>
      <polygon className={isSelected ? styles.aircraft : styles.aircraftInactive} points={points} />
      <text
        className={isSelected ? styles.aircraftLabel : styles.aircraftLabelDimmed}
        x={x - 7}
        y={labelY}
        textAnchor="middle"
      >
        {label}
      </text>
    </g>
  )
}

/** Altitude number only — no ≥/≤ prefix; the bar(s) express the semantics instead (FAA plate convention). */
function altNumberOnly(c: AltConstraint): string {
  const f = (n: number) => n.toLocaleString('en-US')
  switch (c.type) {
    case 'AT': return f(c.low)
    case 'AT_OR_ABOVE': return f(c.low)
    case 'AT_OR_BELOW': return f(c.high ?? c.low)
    case 'BETWEEN': return `${f(c.low)}–${f(c.high ?? c.low)}`
  }
}

/**
 * Altitude restriction text with over/under bars (FAA plate convention): the
 * bars span the number's width and the number is centered between them, sitting
 * above the fix so it clears the role glyphs on the descent line. A line under
 * = at-or-above (minimum), over = at-or-below (maximum), both = mandatory.
 * The GS-intercept altitude is always drawn as a minimum (bottom line only) and
 * nudged left so the lightning bolt to its right has room.
 */
function AltAnnotation({ f, x, y }: { f: ProfileFix; x: number; y: number }) {
  if (!f.constraint) return null
  const label = altNumberOnly(f.constraint)
  const halfW = (label.length * ALT_CHAR_W) / 2
  const type = f.constraint.type
  let showAbove = type === 'AT_OR_BELOW' || type === 'AT' || type === 'BETWEEN'
  let showBelow = type === 'AT_OR_ABOVE' || type === 'AT' || type === 'BETWEEN'
  if (f.isGsIntercept) {
    showAbove = false
    showBelow = true
  }
  // The GS-intercept altitude is placed at the tail of the lightning bolt (up
  // and to the right of the fix); everything else sits centered above its fix.
  const cx = f.isGsIntercept ? x + GS_BOLT_TAIL.dx + GS_ALT_GAP + halfW : x
  const cy = f.isGsIntercept ? y + GS_BOLT_TAIL.dy : y - ALT_CY_OFFSET

  return (
    <g>
      {showAbove && (
        <line className={styles.altBar} x1={cx - halfW} y1={cy - ALT_BAR_HALF_GAP} x2={cx + halfW} y2={cy - ALT_BAR_HALF_GAP} />
      )}
      <text className={styles.altText} x={cx} y={cy} textAnchor="middle" dominantBaseline="central">{label}</text>
      {showBelow && (
        <line className={styles.altBar} x1={cx - halfW} y1={cy + ALT_BAR_HALF_GAP} x2={cx + halfW} y2={cy + ALT_BAR_HALF_GAP} />
      )}
    </g>
  )
}

// ── main component ─────────────────────────────────────────────────────

// Memoized: the live-aircraft tick re-renders the parent every second, but
// the static profile geometry only depends on model/width/height.
export const ProfileSvg = memo(function ProfileSvg({ model, liveAircraft = [], width, height }: Props) {
  if (model.fixes.length < 2) {
    return (
      <svg className={styles.svg} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <text x={width / 2} y={height / 2} textAnchor="middle" className={styles.emptyText}>
          Not enough procedure geometry to draw a profile
        </text>
      </svg>
    )
  }

  const chartTop = MARGIN.top + TOP_BAND_H
  const chartBottom = Math.max(height - MARGIN.bottom - BOTTOM_BAND_H, chartTop + 20)
  // Reserve headroom at the top of the plot so the highest fix's altitude
  // label sits below the name band, not on top of it.
  const plotTop = chartTop + ALT_HEADROOM
  const plotH = Math.max(chartBottom - plotTop, 20)
  // Scale x by the approach's own extent (last approach fix), not the full
  // model extent — the missed approach is now a fixed decorative flourish, not
  // a data-scaled path, so the approach can use the panel's full width.
  const approachNm = Math.max(model.fixes[model.fixes.length - 1].distNm, 0.1)
  const [yMin, yMax] = computeYDomain(model)
  const ySpan = yMax - yMin || 1

  // Plotted altitude per fix — interpolated for unconstrained fixes so they
  // sit on the descent line rather than dropping to the runway elevation.
  const fixAlts = fixRenderAltitudes(model)

  // Inset the horizontal domain so the first/last fix labels (centered on their
  // ticks, and widened by an inline speed restriction) don't clip at the edges.
  const plotLeft = MARGIN.left + X_INSET_LEFT
  const plotRight = Math.max(width - MARGIN.right - X_INSET_RIGHT, plotLeft + 1)
  const plotW = plotRight - plotLeft

  const xScale = (nm: number) => plotLeft + (nm / approachNm) * plotW
  const yScale = (ft: number) => plotTop + plotH - ((ft - yMin) / ySpan) * plotH

  // ── primary descent path: linear through the fixes, then the glideslope to the threshold ──
  const descentPts = descentProfilePoints(model)
  const mainPath = descentPts
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xScale(pt.distNm)} ${yScale(pt.altFt)}`)
    .join(' ')

  // The anchor (FAF / gs-intercept) and the threshold — used for the GS
  // label, TCH note, and the 34:1 wedge.
  const gsAnchorPx: PxPt | null =
    descentPts.length >= 2
      ? { x: xScale(descentPts[descentPts.length - 2].distNm), y: yScale(descentPts[descentPts.length - 2].altFt) }
      : null
  const thresholdPx: PxPt = {
    x: xScale(descentPts[descentPts.length - 1].distNm),
    y: yScale(descentPts[descentPts.length - 1].altFt),
  }
  const gsLabelPos = gsAnchorPx
    ? { x: (gsAnchorPx.x + thresholdPx.x) / 2, y: (gsAnchorPx.y + thresholdPx.y) / 2 - 8 }
    : null

  // ── missed approach: a short dotted curve that leaves the runway and turns
  //    up, ending in a solid arrowhead — the FAA-plate flourish, not the full
  //    (space-hungry, rarely-needed) climb path. ──
  const hasMissed = model.missed.length > 0
  const missedFlourish = (() => {
    if (!hasMissed) return null
    const sx = thresholdPx.x
    const sy = thresholdPx.y
    const ex = sx + 44
    const ey = sy - 42
    const cx = sx + 26 // control at the start height → leaves horizontally, then curves up
    const cy = sy
    const path = `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`
    // Arrowhead aligned to the curve's tangent at the end (control → end).
    const dx = ex - cx
    const dy = ey - cy
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len
    const perpX = -uy
    const perpY = ux
    const AH = 9 // arrowhead length
    const AW = 5 // arrowhead half-width
    const bx = ex - ux * AH
    const by = ey - uy * AH
    const arrow = `${ex},${ey} ${bx + perpX * AW},${by + perpY * AW} ${bx - perpX * AW},${by - perpY * AW}`
    return { path, arrow }
  })()

  // ── 34:1 clear-surface wedge (FAF → threshold), forked tail at the FAF end ──
  const wedgePath = gsAnchorPx ? buildWedgePath(gsAnchorPx, thresholdPx) : null

  // ── top-band fix-name labels, staggered downward following the descent,
  //    then de-collided: a name that would overlap its neighbour horizontally
  //    is pushed to a lower row so closely-spaced fixes stay readable. ──
  const nameAlts = model.fixes.map((f) => f.plotAltFt ?? model.tdzeFt ?? null)
  const nameOffsets = labelStaggerOffsets(nameAlts, LABEL_STAGGER_MAX)
  const nameHalfW = (f: ProfileFix) => {
    const chars = f.fixId.length + (f.speedKt > 0 ? String(f.speedKt).length + 2 : 0)
    return (chars * NAME_CHAR_W) / 2
  }
  for (let i = 1; i < model.fixes.length; i++) {
    const gap = xScale(model.fixes[i].distNm) - xScale(model.fixes[i - 1].distNm)
    const need = nameHalfW(model.fixes[i]) + nameHalfW(model.fixes[i - 1]) + 4
    if (gap < need && nameOffsets[i] - nameOffsets[i - 1] < NAME_ROW_H) {
      nameOffsets[i] = nameOffsets[i - 1] + NAME_ROW_H
    }
  }

  // ── bottom-band inter-fix distance scale ──
  const segDists = segmentDistancesNm(model.fixes)
  const distTickTopY = chartBottom + 3
  const distTickBotY = chartBottom + 9
  const distTextY = chartBottom + 20

  return (
    <svg className={styles.svg} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {/* ground / runway reference — a short mark near the threshold, not a
          full-width baseline under the whole profile */}
      {model.tdzeFt != null && (() => {
        const gy = yScale(model.tdzeFt)
        const rwLeft = Math.max(thresholdPx.x - 78, MARGIN.left)
        const rwRight = Math.min(thresholdPx.x + 44, width - MARGIN.right)
        // Label sits to the right of the threshold/MAP glyph, tucked under the
        // rising missed-approach arrow — clear of the glideslope descent line
        // that comes down to the threshold from the left.
        return (
          <g>
            <line className={styles.groundLine} x1={rwLeft} y1={gy} x2={rwRight} y2={gy} />
            <text className={styles.groundLabel} x={thresholdPx.x + 10} y={gy + 13}>
              TDZE {model.tdzeFt.toLocaleString('en-US')}
            </text>
          </g>
        )
      })()}

      {/* 34:1 clear-surface wedge — drawn below the path lines */}
      {wedgePath && <path className={styles.clearSurfaceWedge} d={wedgePath} />}

      {/* primary descent path: linear through the fixes, glideslope to the threshold */}
      <path className={styles.descentPath} d={mainPath} />

      {gsAnchorPx && gsLabelPos && (
        <g>
          <text className={styles.gsLabel} x={gsLabelPos.x} y={gsLabelPos.y} textAnchor="middle">
            {`GS ${model.gsAngleDeg.toFixed(2)}°${model.usedFallbackGs ? '*' : ''}`}
          </text>
          {model.tchFt != null && (
            <text className={styles.gsLabel} x={thresholdPx.x} y={distTextY} textAnchor="middle">
              {`TCH ${model.tchFt}′`}
            </text>
          )}
        </g>
      )}

      {/* missed approach — dotted curve up to a solid arrowhead */}
      {missedFlourish && (
        <g>
          <path className={styles.missedPath} d={missedFlourish.path} fill="none" />
          <polygon className={styles.missedArrow} points={missedFlourish.arrow} />
        </g>
      )}

      {/* top band: fix names + DME boxes, dashed vertical ticks down to the path */}
      {model.fixes.map((f, i) => {
        const x = xScale(f.distNm)
        const nameY = MARGIN.top + NAME_TOP_PAD + nameOffsets[i]
        const dmeY = nameY + DME_ROW_GAP
        const pathY = yScale(fixAlts[i])
        const dmeW = f.dmeNm != null ? dmeGlyphWidth(f.dmeNm) * DME_SCALE : 0

        return (
          <g key={`name-${f.fixId}-${i}`}>
            <line className={styles.tick} x1={x} y1={nameY + 4} x2={x} y2={pathY} />

            <text className={styles.fixName} x={x} y={nameY} textAnchor="middle">
              {f.fixId}
              {f.speedKt > 0 && <tspan className={styles.speedInline}> {f.speedKt}K</tspan>}
            </text>

            {f.dmeNm != null && (
              <g transform={`translate(${x - dmeW / 2} ${dmeY})`}>
                {f.dmeNavaidId && (
                  <text className={styles.dmeIdent} x={dmeW / 2} y={-2} textAnchor="middle">
                    {f.dmeNavaidId}{f.isDmeArc ? ' ARC' : ''}
                  </text>
                )}
                <g transform={`scale(${DME_SCALE})`}>
                  <DmeD nm={f.dmeNm} standalone={false} />
                </g>
              </g>
            )}
          </g>
        )
      })}

      {/* chart: altitude constraint bars/text and role glyphs (approach fixes) */}
      {model.fixes.map((f, i) => {
        const x = xScale(f.distNm)
        const y = yScale(fixAlts[i])
        const hold = model.holds.find((h) => !h.inMissed && h.atFixIdx === i)
        // The runway/threshold fix's crossing altitude is redundant with the
        // TDZE and TCH already shown near the runway — skip it to reduce noise.
        const isRunwayFix = i === model.fixes.length - 1

        return (
          <g key={`${f.fixId}-${i}`}>
            {!isRunwayFix && <AltAnnotation f={f} x={x} y={y} />}

            {f.isGsIntercept && <ProfileBolt x={x} y={y} />}
            {f.role === 'faf' && <MalteseCross x={x} y={y} />}
            {f.role === 'map' && <MapGlyph x={x} y={y} />}
            {hold && <HoldGlyph x={x} y={y} isPi={hold.kind === 'PI'} />}
          </g>
        )
      })}

      {/* bottom band: inter-fix distance scale */}
      <g>
        <line
          className={styles.distBaseline}
          x1={xScale(model.fixes[0].distNm)}
          y1={distTickTopY}
          x2={xScale(model.fixes[model.fixes.length - 1].distNm)}
          y2={distTickTopY}
        />
        {model.fixes.map((f, i) => (
          <line
            key={`dtick-${i}`}
            className={styles.distTick}
            x1={xScale(f.distNm)}
            y1={distTickTopY}
            x2={xScale(f.distNm)}
            y2={distTickBotY}
          />
        ))}
        {segDists.map((d, i) => {
          const x1 = xScale(model.fixes[i].distNm)
          const x2 = xScale(model.fixes[i + 1].distNm)
          return (
            <text key={`dtext-${i}`} className={styles.distText} x={(x1 + x2) / 2} y={distTextY} textAnchor="middle">
              {d.toFixed(1)} NM
            </text>
          )
        })}
      </g>

      {/* live aircraft — one glyph per plane the detector currently has assigned
          to this approach; the selected one (if any) gets accent styling, the
          rest are dimmed. Labels alternate above/below when entries crowd. */}
      {liveAircraft.length > 0 && (() => {
        const nmPerPx = plotW > 0 ? approachNm / plotW : 1
        const labelSides = placeProfileLabels(liveAircraft, nmPerPx)
        return liveAircraft.map((ac, i) => (
          <AircraftGlyph
            key={ac.hex}
            x={xScale(ac.distNm)}
            y={yScale(ac.altFt)}
            label={ac.label}
            isSelected={ac.isSelected}
            labelAbove={labelSides[i] === 'above'}
          />
        ))
      })()}
    </svg>
  )
})
