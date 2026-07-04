import { memo } from 'react'
import type { AltConstraint } from '../../types/procedure'
import { BoltGlyph, DmeD, dmeGlyphWidth } from '../map/glyphs'
import {
  descentProfilePoints,
  segmentDistancesNm,
  labelStaggerOffsets,
} from '../../geo/profileMath'
import type { ProfileFix, ProfileModel, LiveAircraft } from '../../geo/profileMath'
import styles from './ProfileSvg.module.css'

interface Props {
  model: ProfileModel
  liveAircraft?: LiveAircraft | null
  width: number
  height: number
}

// ── layout constants (module-local — do not confuse with config/constants.ts) ──
const MARGIN = { top: 4, right: 26, bottom: 4, left: 16 }
const TOP_BAND_H = 56 // fix names + DME boxes, staggered following the descent
const BOTTOM_BAND_H = 22 // inter-fix distance scale
const NAME_TOP_PAD = 12 // px from the top of the band to the highest fix's label baseline
const LABEL_STAGGER_MAX = 26 // px the label baseline steps down inside the top band
const DME_ROW_GAP = 12 // px from the name baseline down to the DME ident/glyph row
const DME_SCALE = 0.78 // shrink the shared DmeD glyph to fit the label band
const WEDGE_HALF_WIDTH_PX = 15 // 34:1 clear-surface wedge half-height at the FAF end
const WEDGE_TIP_HALF_WIDTH_PX = 3 // half-height at the threshold end (not a perfect point — stays visible)
const WEDGE_NOTCH_PX = 7 // forked-tail notch depth, cut into the wide (FAF) end

// ── scales ──────────────────────────────────────────────────────────────

function computeYDomain(model: ProfileModel): [number, number] {
  const alts: number[] = []
  if (model.tdzeFt != null) alts.push(model.tdzeFt)
  for (const f of [...model.fixes, ...model.missed]) {
    if (f.plotAltFt != null) alts.push(f.plotAltFt)
  }
  if (alts.length === 0) alts.push(0, 3000)
  const lo = Math.min(...alts)
  const hi = Math.max(...alts)
  return [lo - 300, hi + 500]
}

/** Best-effort plotting altitude for a fix that carries no explicit constraint. */
function fixAlt(f: ProfileFix, model: ProfileModel): number {
  return f.plotAltFt ?? model.tdzeFt ?? 0
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
 * Glideslope-intercept bolt, built on the shared map glyph. Points down-right
 * onto the intercept point (the FAF, riding the glideslope) from a spot up
 * and to the left — the same "aim at the fix" convention WaypointMarkers uses.
 */
function ProfileBolt({ x, y }: { x: number; y: number }) {
  return <BoltGlyph from={{ x: x - 14, y: y - 20 }} to={{ x, y }} standalone={false} />
}

function MalteseCross({ x, y }: { x: number; y: number }) {
  const s = 5
  const t = 1.6
  return (
    <g className={styles.malteseCross} transform={`translate(${x} ${y - 16})`}>
      <path
        d={`M ${-t} ${-s} H ${t} V ${-t} H ${s} V ${t} H ${t} V ${s} H ${-t} V ${t} H ${-s} V ${-t} H ${-t} Z`}
      />
    </g>
  )
}

function MapGlyph({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y - 20})`}>
      <circle r={7} className={styles.mapGlyph} />
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

function AircraftGlyph({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <polygon className={styles.aircraft} points={`${x - 7},${y + 5} ${x + 8},${y} ${x - 7},${y - 5} ${x - 3},${y}`} />
      <text className={styles.aircraftLabel} x={x} y={y - 10} textAnchor="middle">{label}</text>
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
 * Altitude restriction text with over/under bars, clearly offset above/below
 * the text's own bounding box so the bars never strike through the digits
 * (see requirement #7 — the old rendering overlapped bar and glyph).
 */
function AltAnnotation({ f, x, y }: { f: ProfileFix; x: number; y: number }) {
  if (!f.constraint) return null
  const textY = y - 16
  const barAboveY = textY - 9
  const barBelowY = textY + 3
  const showAbove = f.constraint.type === 'AT_OR_BELOW' || f.constraint.type === 'AT' || f.constraint.type === 'BETWEEN'
  const showBelow = f.constraint.type === 'AT_OR_ABOVE' || f.constraint.type === 'AT' || f.constraint.type === 'BETWEEN'

  return (
    <g>
      {showAbove && <line className={styles.altBar} x1={x - 13} y1={barAboveY} x2={x + 13} y2={barAboveY} />}
      <text className={styles.altText} x={x} y={textY} textAnchor="middle">{altNumberOnly(f.constraint)}</text>
      {showBelow && <line className={styles.altBar} x1={x - 13} y1={barBelowY} x2={x + 13} y2={barBelowY} />}
    </g>
  )
}

// ── main component ─────────────────────────────────────────────────────

// Memoized: the live-aircraft tick re-renders the parent every second, but
// the static profile geometry only depends on model/width/height.
export const ProfileSvg = memo(function ProfileSvg({ model, liveAircraft, width, height }: Props) {
  if (model.fixes.length < 2) {
    return (
      <svg className={styles.svg} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <text x={width / 2} y={height / 2} textAnchor="middle" className={styles.emptyText}>
          Not enough procedure geometry to draw a profile
        </text>
      </svg>
    )
  }

  const innerW = Math.max(width - MARGIN.left - MARGIN.right, 1)
  const chartTop = MARGIN.top + TOP_BAND_H
  const chartBottom = Math.max(height - MARGIN.bottom - BOTTOM_BAND_H, chartTop + 20)
  const innerH = chartBottom - chartTop
  const totalNm = Math.max(model.totalNm, 0.1)
  const [yMin, yMax] = computeYDomain(model)
  const ySpan = yMax - yMin || 1

  const xScale = (nm: number) => MARGIN.left + (nm / totalNm) * innerW
  const yScale = (ft: number) => chartTop + innerH - ((ft - yMin) / ySpan) * innerH

  const allFixes = [...model.fixes, ...model.missed]

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

  // ── dashed climbing missed-approach path ──
  let missedPath = ''
  let missedArrowEnd: PxPt | null = null
  if (model.missed.length > 0) {
    const mapFix = model.fixes[model.fixes.length - 1]
    let prevAlt = fixAlt(mapFix, model)
    missedPath = `M ${xScale(mapFix.distNm)} ${yScale(prevAlt)}`
    for (const f of model.missed) {
      const alt = f.plotAltFt ?? prevAlt + 500
      missedPath += ` L ${xScale(f.distNm)} ${yScale(alt)}`
      prevAlt = alt
    }
    const last = model.missed[model.missed.length - 1]
    missedArrowEnd = { x: xScale(last.distNm), y: yScale(prevAlt) }
  }

  // ── 34:1 clear-surface wedge (FAF → threshold), forked tail at the FAF end ──
  const wedgePath = gsAnchorPx ? buildWedgePath(gsAnchorPx, thresholdPx) : null

  // ── top-band fix-name labels, staggered downward following the descent ──
  const nameAlts = model.fixes.map((f) => f.plotAltFt ?? model.tdzeFt ?? null)
  const nameOffsets = labelStaggerOffsets(nameAlts, LABEL_STAGGER_MAX)

  // ── bottom-band inter-fix distance scale ──
  const segDists = segmentDistancesNm(model.fixes)
  const distTickTopY = chartBottom + 2
  const distTickBotY = chartBottom + 8
  const distTextY = chartBottom + 17

  return (
    <svg className={styles.svg} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {/* ground reference line */}
      {model.tdzeFt != null && (
        <g>
          <line
            className={styles.groundLine}
            x1={MARGIN.left}
            y1={yScale(model.tdzeFt)}
            x2={width - MARGIN.right}
            y2={yScale(model.tdzeFt)}
          />
          <text className={styles.groundLabel} x={MARGIN.left + 2} y={yScale(model.tdzeFt) - 4}>
            TDZE {model.tdzeFt.toLocaleString('en-US')}
          </text>
        </g>
      )}

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
            <text className={styles.gsLabel} x={thresholdPx.x} y={thresholdPx.y + 14} textAnchor="middle">
              {`TCH ${model.tchFt}′`}
            </text>
          )}
        </g>
      )}

      {/* missed approach */}
      {missedPath && (
        <g>
          <path className={styles.missedPath} d={missedPath} />
          {missedArrowEnd && (
            <polygon
              className={styles.missedArrow}
              points={`${missedArrowEnd.x - 4},${missedArrowEnd.y + 4} ${missedArrowEnd.x + 4},${missedArrowEnd.y + 4} ${missedArrowEnd.x},${missedArrowEnd.y - 5}`}
            />
          )}
        </g>
      )}

      {/* top band: fix names + DME boxes, dashed vertical ticks down to the path */}
      {model.fixes.map((f, i) => {
        const x = xScale(f.distNm)
        const nameY = MARGIN.top + NAME_TOP_PAD + nameOffsets[i]
        const dmeY = nameY + DME_ROW_GAP
        const pathY = yScale(fixAlt(f, model))
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

      {/* chart: altitude constraint bars/text and role glyphs, approach + missed fixes */}
      {allFixes.map((f, i) => {
        const isMissedFix = i >= model.fixes.length
        const x = xScale(f.distNm)
        const alt = fixAlt(f, model)
        const y = yScale(alt)
        const hold = model.holds.find(
          (h) => h.inMissed === isMissedFix && h.atFixIdx === (isMissedFix ? i - model.fixes.length : i),
        )

        return (
          <g key={`${f.fixId}-${i}`}>
            {isMissedFix && (
              <text className={styles.missedFixName} x={x} y={y - 10} textAnchor="middle">{f.fixId}</text>
            )}

            <AltAnnotation f={f} x={x} y={y} />

            {isMissedFix && f.isDmeArc && (
              <text className={styles.arcText} x={x} y={y + 16} textAnchor="middle">
                {f.dmeNm != null ? `${f.dmeNm} DME ARC` : 'DME ARC'}
              </text>
            )}

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

      {/* live aircraft */}
      {liveAircraft && (
        <AircraftGlyph x={xScale(liveAircraft.distNm)} y={yScale(liveAircraft.altFt)} label={liveAircraft.label} />
      )}
    </svg>
  )
})
