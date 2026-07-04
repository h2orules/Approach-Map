import { memo } from 'react'
import { formatAltConstraint } from '../../utils/altitudeConstraint'
import { glideslopeAltAt } from '../../geo/profileMath'
import type { ProfileFix, ProfileModel, LiveAircraft } from '../../geo/profileMath'
import styles from './ProfileSvg.module.css'

interface Props {
  model: ProfileModel
  liveAircraft?: LiveAircraft | null
  width: number
  height: number
}

const MARGIN = { top: 30, right: 26, bottom: 46, left: 16 }

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

// ── small presentational glyphs ────────────────────────────────────────

function BoltGlyph({ x, y }: { x: number; y: number }) {
  // Small lightning-bolt centered above the fix — glideslope intercept.
  return (
    <polygon
      className={styles.boltGlyph}
      points={`${x - 2},${y - 22} ${x + 3},${y - 22} ${x - 1},${y - 14} ${x + 4},${y - 14} ${x - 4},${y - 4} ${x - 1},${y - 13} ${x - 6},${y - 13}`}
    />
  )
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
  const innerH = Math.max(height - MARGIN.top - MARGIN.bottom, 1)
  const totalNm = Math.max(model.totalNm, 0.1)
  const [yMin, yMax] = computeYDomain(model)
  const ySpan = yMax - yMin || 1

  const xScale = (nm: number) => MARGIN.left + (nm / totalNm) * innerW
  const yScale = (ft: number) => MARGIN.top + innerH - ((ft - yMin) / ySpan) * innerH

  const allFixes = [...model.fixes, ...model.missed]
  const thresholdDistNm = model.fixes[model.fixes.length - 1].distNm
  const chartBottomY = MARGIN.top + innerH

  // ── step-down path through the approach fixes ──
  let stepPath = `M ${xScale(model.fixes[0].distNm)} ${yScale(fixAlt(model.fixes[0], model))}`
  for (let i = 1; i < model.fixes.length; i++) {
    const prev = model.fixes[i - 1]
    const cur = model.fixes[i]
    const prevY = yScale(fixAlt(prev, model))
    const curX = xScale(cur.distNm)
    stepPath += ` L ${curX} ${prevY} L ${curX} ${yScale(fixAlt(cur, model))}`
  }

  // ── dashed missed-approach climb path ──
  let missedPath = ''
  let missedArrowEnd: { x: number; y: number } | null = null
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

  // ── glideslope ──
  const gsFix = model.fixes.find((f) => f.isGsIntercept)
  let gsLine: { x1: number; y1: number; x2: number; y2: number } | null = null
  let gsLabelPos: { x: number; y: number } | null = null
  if (gsFix) {
    const startAlt = gsFix.plotAltFt ?? glideslopeAltAt(model, thresholdDistNm - gsFix.distNm)
    const endAlt = glideslopeAltAt(model, 0)
    gsLine = {
      x1: xScale(gsFix.distNm),
      y1: yScale(startAlt),
      x2: xScale(thresholdDistNm),
      y2: yScale(endAlt),
    }
    gsLabelPos = { x: (gsLine.x1 + gsLine.x2) / 2, y: (gsLine.y1 + gsLine.y2) / 2 - 8 }
  }

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

      {/* step-down altitude path */}
      <path className={styles.stepPath} d={stepPath} />

      {/* glideslope */}
      {gsLine && (
        <g>
          <line className={styles.gsLine} x1={gsLine.x1} y1={gsLine.y1} x2={gsLine.x2} y2={gsLine.y2} />
          {gsLabelPos && (
            <text className={styles.gsLabel} x={gsLabelPos.x} y={gsLabelPos.y} textAnchor="middle">
              {`GS ${model.gsAngleDeg.toFixed(1)}°${model.usedFallbackGs ? '*' : ''}`}
            </text>
          )}
          {model.tchFt != null && (
            <text className={styles.gsLabel} x={xScale(thresholdDistNm)} y={gsLine.y2 + 14} textAnchor="middle">
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

      {/* per-fix ticks, labels, glyphs */}
      {allFixes.map((f, i) => {
        const isMissedFix = i >= model.fixes.length
        const x = xScale(f.distNm)
        const alt = fixAlt(f, model)
        const y = yScale(alt)
        const altLabel = formatAltConstraint(f.constraint)
        const hold = model.holds.find((h) => h.inMissed === isMissedFix && h.atFixIdx === (isMissedFix ? i - model.fixes.length : i))

        return (
          <g key={`${f.fixId}-${i}`}>
            <line className={styles.tick} x1={x} y1={MARGIN.top} x2={x} y2={chartBottomY} />

            <text className={styles.fixName} x={x} y={chartBottomY + 14} textAnchor="middle">
              {f.fixId}
            </text>

            {altLabel && (
              <g>
                {(f.constraint?.type === 'AT_OR_BELOW' || f.constraint?.type === 'AT' || f.constraint?.type === 'BETWEEN') && (
                  <line className={styles.altBar} x1={x - 12} y1={y - 22} x2={x + 12} y2={y - 22} />
                )}
                <text className={styles.altText} x={x} y={y - 18} textAnchor="middle">{altLabel}</text>
                {(f.constraint?.type === 'AT_OR_ABOVE' || f.constraint?.type === 'AT' || f.constraint?.type === 'BETWEEN') && (
                  <line className={styles.altBar} x1={x - 12} y1={y - 14} x2={x + 12} y2={y - 14} />
                )}
              </g>
            )}

            {f.speedKt > 0 && (
              <text className={styles.speedText} x={x} y={chartBottomY + 26} textAnchor="middle">
                {f.speedKt}K
              </text>
            )}

            {f.isDmeArc && (
              <text className={styles.arcText} x={x} y={chartBottomY + 38} textAnchor="middle">
                {f.dmeNm != null ? `${f.dmeNm} DME ARC` : 'DME ARC'}
              </text>
            )}

            {f.isGsIntercept && <BoltGlyph x={x} y={y} />}
            {!f.isGsIntercept && f.role === 'faf' && <MalteseCross x={x} y={y} />}
            {f.role === 'map' && <MapGlyph x={x} y={y} />}
            {hold && <HoldGlyph x={x} y={y} isPi={hold.kind === 'PI'} />}
          </g>
        )
      })}

      {/* live aircraft */}
      {liveAircraft && (
        <AircraftGlyph x={xScale(liveAircraft.distNm)} y={yScale(liveAircraft.altFt)} label={liveAircraft.label} />
      )}
    </svg>
  )
})
