import { memo } from 'react'
import type { AltConstraint } from '../../types/procedure'
import { BoltGlyph, DmeD, dmeGlyphWidth, MALTESE_PATH } from '../map/glyphs'
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
const TOP_BAND_H = 36 // fix names (the DME chip rides inline beside the name), staggered following the descent
const BOTTOM_BAND_H = 26 // inter-fix distance scale
const NAME_TOP_PAD = 14 // px from the top of the band to the highest fix's label baseline
const LABEL_STAGGER_MAX = 14 // px the label baseline steps down inside the top band
const DME_SCALE = 0.8 // scale the shared DmeD glyph to sit inline beside the 12px fix name
const DME_H_PX = 14 // px intrinsic height of the shared DmeD glyph (glyphs.tsx DME_H) — for inline baseline alignment
const DME_INLINE_GAP = 5 // px between the fix name's right edge and the inline ident/DME chip
const DME_IDENT_CHAR_W = 5.2 // px per char of the 8.5px mono DME ident — inline layout + collision width
const WEDGE_HALF_WIDTH_PX = 15 // 34:1 clear-surface wedge half-height at the FAF end
const WEDGE_TIP_HALF_WIDTH_PX = 3 // half-height at the threshold end (not a perfect point — stays visible)
const WEDGE_NOTCH_PX = 7 // forked-tail notch depth, cut into the wide (FAF) end
const X_INSET_LEFT = 34 // horizontal room inside the left margin so the first fix label (name + speed) doesn't clip
const X_INSET_RIGHT = 76 // larger right inset: the last fix's label PLUS the TDZE note (which sits past the threshold) must fit — keeps the drawn profile visually centered
const ALT_HEADROOM = 16 // vertical room above the highest fix so its altitude label clears the name band
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
const MARKER_LABEL_H = 10 // px added to the name band (and the fix name lifted by this) for a marker fix's second label line (OM/MM/IM)
const MARKER_CONE_HALF_W = 9 // px half-width of the marker's dotted cone at the top of the plot
// ── course-reversal (procedure-turn) excursion, drawn left of the anchor fix ──
const REVERSAL_VERTEX_INSET = 24 // px from the plot's left edge the excursion vertex sits (when there's room)
const REVERSAL_ARROW_LEN = 8 // px arrowhead length along each reversal leg
const REVERSAL_ARROW_HALF = 4 // px arrowhead half-width
const REVERSAL_COURSE_OFFSET = 11 // px the course label's center sits perpendicular off its leg (clear of the stroke)
const ROLE_TAG_H = 9 // px lifted off the name baseline for an IAF/IF role tag line
// ── hold-in-lieu-of-PT (HILPT) racetrack segment, drawn left of its anchor fix ──
const HOLD_LINE_GAP = 12 // px between the outbound (upper) and inbound (lower) lines
const HOLD_EXT_W = 88 // px the racetrack lines extend left of the anchor fix
const HOLD_EXTRA_INSET = 96 // extra left inset reserved so the figure (plus its alt label) fits
// Aircraft glyph scale — bumped up from the original size for legibility;
// body dimensions, label offset, and label text size (CSS) all scale with it
// so the callsign stays proportional to the feather it's labeling.
const AIRCRAFT_GLYPH_SCALE = 1.4
const AIRCRAFT_BODY_LEN = 15 * AIRCRAFT_GLYPH_SCALE // tip-to-tail length
const AIRCRAFT_BODY_HALF_H = 5 * AIRCRAFT_GLYPH_SCALE // half-height at the tail
const AIRCRAFT_NOTCH_LEN = 11 * AIRCRAFT_GLYPH_SCALE // tail-notch depth from the tip
const AIRCRAFT_LABEL_X_OFFSET = -7 * AIRCRAFT_GLYPH_SCALE // px, tip → label horizontal center
const AIRCRAFT_LABEL_ABOVE_DY = -10 * AIRCRAFT_GLYPH_SCALE // px from the glyph tip to the label baseline, above
const AIRCRAFT_LABEL_BELOW_DY = 17 * AIRCRAFT_GLYPH_SCALE // px from the glyph tip to the label baseline, below

// ── scales ──────────────────────────────────────────────────────────────

function computeYDomain(model: ProfileModel): [number, number] {
  // Approach fixes only — the missed approach is no longer plotted, so its
  // (often much higher) altitudes must not stretch the vertical scale.
  const alts: number[] = []
  if (model.tdzeFt != null) alts.push(model.tdzeFt)
  for (const f of model.fixes) {
    if (f.plotAltFt != null) alts.push(f.plotAltFt)
  }
  // The course-reversal excursion climbs well above the final-segment fixes
  // (e.g. a 6000 entry over a 1700 FAF) — include it or the barb clips the top.
  if (model.courseReversal) {
    if (model.courseReversal.entryAltFt != null) alts.push(model.courseReversal.entryAltFt)
    if (model.courseReversal.vertexAltFt != null) alts.push(model.courseReversal.vertexAltFt)
  }
  if (model.holdInLieu?.altFt != null) alts.push(model.holdInLieu.altFt)
  if (alts.length === 0) alts.push(0, 3000)
  const lo = Math.min(...alts)
  const hi = Math.max(...alts)
  // Tight padding so the plotted path stretches over the available height —
  // labels above the top fix render into the ALT_HEADROOM band instead.
  return [lo - 150, hi + 250]
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

// The FAF maltese cross (cross patée) is shared with the map FAF marker —
// geometry lives in ../map/glyphs (MALTESE_PATH), drawn upright and rotated here.
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
  const points =
    `${x - AIRCRAFT_BODY_LEN},${y + AIRCRAFT_BODY_HALF_H} ${x},${y} ` +
    `${x - AIRCRAFT_BODY_LEN},${y - AIRCRAFT_BODY_HALF_H} ${x - AIRCRAFT_NOTCH_LEN},${y}`
  return (
    <g>
      <polygon className={isSelected ? styles.aircraft : styles.aircraftInactive} points={points} />
      <text
        className={isSelected ? styles.aircraftLabel : styles.aircraftLabelDimmed}
        x={x + AIRCRAFT_LABEL_X_OFFSET}
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

/**
 * Altitude number centered at (cx, cy) with FAA over/under bars derived from
 * the constraint type (overline = at-or-below max, underline = at-or-above
 * min, both = mandatory). Shared by the course-reversal excursion.
 */
function ConstraintText({ constraint, cx, cy }: { constraint: AltConstraint; cx: number; cy: number }) {
  const label = altNumberOnly(constraint)
  const halfW = (label.length * ALT_CHAR_W) / 2
  const type = constraint.type
  const showAbove = type === 'AT_OR_BELOW' || type === 'AT' || type === 'BETWEEN'
  const showBelow = type === 'AT_OR_ABOVE' || type === 'AT' || type === 'BETWEEN'
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

/** Arrowhead polygon points: tip at (tx,ty), pointing along unit vector (ux,uy). */
function arrowHeadPoints(tx: number, ty: number, ux: number, uy: number): string {
  const bx = tx - ux * REVERSAL_ARROW_LEN
  const by = ty - uy * REVERSAL_ARROW_LEN
  const px = -uy
  const py = ux
  return (
    `${tx},${ty} ` +
    `${bx + px * REVERSAL_ARROW_HALF},${by + py * REVERSAL_ARROW_HALF} ` +
    `${bx - px * REVERSAL_ARROW_HALF},${by - py * REVERSAL_ARROW_HALF}`
  )
}

/**
 * FAA-plate course-reversal (procedure-turn) excursion, drawn to the LEFT of
 * the anchor fix: an upper (outbound) leg from the entry altitude sloping down
 * to a left vertex at the PT-completion altitude, then a lower (inbound) leg
 * back down to the anchor fix, where the normal descent resumes. Courses are
 * labeled with arrows (outbound away from the fix, inbound toward it).
 */
function CourseReversalExcursion({
  reversal,
  anchorX,
  vertexX,
  entryY,
  vertexY,
  rejoinY,
}: {
  reversal: NonNullable<ProfileModel['courseReversal']>
  anchorX: number
  vertexX: number
  entryY: number
  vertexY: number
  rejoinY: number
}) {
  // Upper leg: entry (anchorX, entryY) → vertex (vertexX, vertexY).
  const upDx = vertexX - anchorX
  const upDy = vertexY - entryY
  const upLen = Math.hypot(upDx, upDy) || 1
  const upUx = upDx / upLen
  const upUy = upDy / upLen
  // Lower leg: vertex (vertexX, vertexY) → rejoin (anchorX, rejoinY).
  const dnDx = anchorX - vertexX
  const dnDy = rejoinY - vertexY
  const dnLen = Math.hypot(dnDx, dnDy) || 1
  const dnUx = dnDx / dnLen
  const dnUy = dnDy / dnLen

  // Course labels sit at each leg's midpoint, offset perpendicular to the leg
  // (up for the outbound/upper leg, down for the inbound/lower leg) so the
  // path stroke never crosses the text. Both use the same font size.
  const perp = (ux: number, uy: number, up: boolean): PxPt => {
    const n = { x: -uy, y: ux } // one of the two unit normals
    const wantNeg = up // screen-up = negative y
    return (wantNeg ? n.y <= 0 : n.y > 0) ? n : { x: uy, y: -ux }
  }
  const upN = perp(upUx, upUy, true)
  const dnN = perp(dnUx, dnUy, false)
  const outMid = {
    x: (anchorX + vertexX) / 2 + upN.x * REVERSAL_COURSE_OFFSET,
    y: (entryY + vertexY) / 2 + upN.y * REVERSAL_COURSE_OFFSET,
  }
  const inMid = {
    x: (vertexX + anchorX) / 2 + dnN.x * REVERSAL_COURSE_OFFSET,
    y: (vertexY + rejoinY) / 2 + dnN.y * REVERSAL_COURSE_OFFSET,
  }
  const pad = (n: number) => String(Math.round(n)).padStart(3, '0')

  return (
    <g>
      <path
        className={styles.reversalPath}
        d={`M ${anchorX} ${entryY} L ${vertexX} ${vertexY} L ${anchorX} ${rejoinY}`}
        fill="none"
      />
      {/* outbound arrow (points away from the fix, at the vertex end) */}
      <polygon className={styles.reversalArrow} points={arrowHeadPoints(vertexX, vertexY, upUx, upUy)} />
      {/* inbound arrow (points toward the fix, at the anchor end) */}
      <polygon className={styles.reversalArrow} points={arrowHeadPoints(anchorX, rejoinY, dnUx, dnUy)} />

      <text className={styles.reversalCourse} x={outMid.x} y={outMid.y} textAnchor="middle" dominantBaseline="central">
        {`${pad(reversal.outboundCourse)}°`}
      </text>
      <text className={styles.reversalCourse} x={inMid.x} y={inMid.y} textAnchor="middle" dominantBaseline="central">
        {`${pad(reversal.inboundCourse)}°`}
      </text>

      {reversal.entryConstraint && <ConstraintText constraint={reversal.entryConstraint} cx={anchorX} cy={entryY - ALT_CY_OFFSET} />}
      {reversal.vertexConstraint && <ConstraintText constraint={reversal.vertexConstraint} cx={vertexX} cy={vertexY - ALT_CY_OFFSET} />}

      <text className={styles.reversalNote} x={vertexX} y={vertexY + 16} textAnchor="middle">
        {`Remain within ${reversal.limitNm} NM`}
      </text>
    </g>
  )
}

/**
 * FAA-plate hold-in-lieu-of-PT (HILPT) figure, drawn to the LEFT of its anchor
 * fix (mirroring the plate, where the hold extends away from the runway): an
 * upper outbound line with an arrow pointing away from the fix, a lower
 * inbound line arrowed toward it, both courses labeled, the hold's altitude
 * constraint stacked at the open (far) end, and an "N NM Holding Pattern"
 * note above — matching the plate's profile-view hold depiction.
 */
function HoldInLieuFigure({
  hold,
  anchorX,
  extLeft,
  y,
}: {
  hold: NonNullable<ProfileModel['holdInLieu']>
  anchorX: number
  extLeft: number
  y: number
}) {
  const yIn = y // inbound line rides at the anchor's path altitude
  const yOut = y - HOLD_LINE_GAP
  const midX = (extLeft + anchorX) / 2
  const pad = (n: number) => String(Math.round(n)).padStart(3, '0')

  // Constraint at the open end: a BETWEEN splits plate-style (max with its
  // overbar on the outbound row, min underlined on the inbound row); a single
  // constraint centers between the two lines.
  const alt = hold.alt
  const altLabelX = (label: string) => extLeft - (label.length * ALT_CHAR_W) / 2 - 8
  const constraint = !alt ? null : alt.type === 'BETWEEN' ? (
    <g>
      <ConstraintText
        constraint={{ type: 'AT_OR_BELOW', low: alt.high ?? alt.low }}
        cx={altLabelX(altNumberOnly({ type: 'AT_OR_BELOW', low: alt.high ?? alt.low }))}
        cy={yOut}
      />
      <ConstraintText
        constraint={{ type: 'AT_OR_ABOVE', low: alt.low }}
        cx={altLabelX(altNumberOnly({ type: 'AT_OR_ABOVE', low: alt.low }))}
        cy={yIn}
      />
    </g>
  ) : (
    <ConstraintText constraint={alt} cx={altLabelX(altNumberOnly(alt))} cy={(yIn + yOut) / 2} />
  )

  return (
    <g>
      <line className={styles.reversalPath} x1={anchorX} y1={yOut} x2={extLeft} y2={yOut} />
      <line className={styles.reversalPath} x1={extLeft} y1={yIn} x2={anchorX - 2} y2={yIn} />
      {/* outbound arrow (away from the fix), inbound arrow (toward it) */}
      <polygon className={styles.reversalArrow} points={arrowHeadPoints(extLeft, yOut, -1, 0)} />
      <polygon className={styles.reversalArrow} points={arrowHeadPoints(anchorX - 2, yIn, 1, 0)} />

      <text className={styles.reversalCourse} x={midX} y={yOut - 6} textAnchor="middle">
        {`${pad(hold.outboundCourse)}°`}
      </text>
      <text className={styles.reversalCourse} x={midX} y={yIn + 12} textAnchor="middle">
        {`${pad(hold.inboundCourse)}°`}
      </text>

      {constraint}

      <text className={styles.reversalNote} x={midX} y={yOut - 18} textAnchor="middle">
        {`${hold.legNm % 1 === 0 ? hold.legNm : hold.legNm.toFixed(1)} NM Holding Pattern`}
      </text>
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

  // Marker fixes (LOM etc.) get a second label line under their name; grow the
  // name band by that height and push all name baselines down by it, so the
  // marker name can lift back up to its normal spot with the marker type below
  // it — the plot just compresses slightly, nothing clips.
  const markerBandExtra = model.fixes.some((f) => f.marker) ? MARKER_LABEL_H : 0
  const chartTop = MARGIN.top + TOP_BAND_H + markerBandExtra
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

  // A HILPT anchored at the profile's first fix draws its racetrack figure to
  // the LEFT of that fix — reserve the room for it in the left inset.
  const holdAtStart = model.holdInLieu && model.holdInLieu.anchorFixIdx === 0 ? model.holdInLieu : null

  // Inset the horizontal domain so the first/last fix labels (centered on their
  // ticks, and widened by an inline speed restriction) don't clip at the edges.
  const plotLeft = MARGIN.left + X_INSET_LEFT + (holdAtStart ? HOLD_EXTRA_INSET : 0)
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
  // Only drawn for genuinely charted vertical guidance (RNAV path point / ILS
  // glide slope); a coded VDA or the 3° fallback does not earn a clear surface.
  const wedgePath = gsAnchorPx && model.hasChartedVerticalGuidance ? buildWedgePath(gsAnchorPx, thresholdPx) : null

  // ── course-reversal (procedure-turn) excursion geometry, drawn into the
  //    empty space left of the anchor fix (where the flat pre-FAF fixes were
  //    dropped). The vertex sits near the plot's left edge. ──
  const reversalGeom = (() => {
    const rev = model.courseReversal
    if (!rev) return null
    const anchor = model.fixes[rev.anchorFixIdx]
    if (!anchor) return null
    const anchorX = xScale(anchor.distNm)
    const leftGap = anchorX - plotLeft
    if (leftGap < 12) return null // no room to draw the excursion — skip cleanly
    const vertexX = plotLeft + Math.min(REVERSAL_VERTEX_INSET, leftGap * 0.35)
    const rejoinY = yScale(fixAlts[rev.anchorFixIdx])
    const entryY = yScale(rev.entryAltFt ?? fixAlts[rev.anchorFixIdx])
    const vertexY = yScale(rev.vertexAltFt ?? fixAlts[rev.anchorFixIdx])
    return { rev, anchorX, vertexX, entryY, vertexY, rejoinY }
  })()

  // ── hold-in-lieu-of-PT racetrack figure, left of its anchor fix (only drawn
  //    when the hold anchors the profile's first fix — the HILPT entry). ──
  const holdGeom = (() => {
    if (!holdAtStart) return null
    const anchor = model.fixes[holdAtStart.anchorFixIdx]
    if (!anchor) return null
    const anchorX = xScale(anchor.distNm)
    const extLeft = Math.max(anchorX - HOLD_EXT_W, MARGIN.left + 6)
    if (anchorX - extLeft < 24) return null // no room — skip cleanly
    return { hold: holdAtStart, anchorX, extLeft, y: yScale(fixAlts[holdAtStart.anchorFixIdx]) }
  })()

  // ── top-band fix-name labels, staggered downward following the descent,
  //    then de-collided: a name that would overlap its neighbour horizontally
  //    is pushed to a lower row so closely-spaced fixes stay readable. ──
  const nameAlts = model.fixes.map((f) => f.plotAltFt ?? model.tdzeFt ?? null)
  const nameOffsets = labelStaggerOffsets(nameAlts, LABEL_STAGGER_MAX)
  const nameHalfW = (f: ProfileFix) => {
    const chars = f.fixId.length + (f.speedKt > 0 ? String(f.speedKt).length + 2 : 0)
    return (chars * NAME_CHAR_W) / 2
  }
  // The inline ident + DME chip extends the label to the RIGHT of the centered
  // fix name — used for both rendering and collision math.
  const dmeInlineW = (f: ProfileFix) => {
    if (f.dmeNm == null) return 0
    const identChars = f.dmeNavaidId ? f.dmeNavaidId.length + (f.isDmeArc ? 4 : 0) : 0
    const identW = identChars > 0 ? identChars * DME_IDENT_CHAR_W + 3 : 0
    return DME_INLINE_GAP + identW + dmeGlyphWidth(f.dmeNm) * DME_SCALE
  }
  for (let i = 1; i < model.fixes.length; i++) {
    const gap = xScale(model.fixes[i].distNm) - xScale(model.fixes[i - 1].distNm)
    const prev = model.fixes[i - 1]
    const need = nameHalfW(model.fixes[i]) + nameHalfW(prev) + dmeInlineW(prev) + 4
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
      {/* marker-beacon cones — narrow dotted triangles rising from the ground at
          each marker fix up to the top of the plot. Rendered first so they sit
          behind every other layer. */}
      {model.fixes.map((f, i) =>
        f.marker ? (
          <polygon
            key={`marker-cone-${f.fixId}-${i}`}
            className={styles.markerCone}
            points={
              `${xScale(f.distNm)},${plotTop + plotH} ` +
              `${xScale(f.distNm) - MARKER_CONE_HALF_W},${plotTop} ` +
              `${xScale(f.distNm) + MARKER_CONE_HALF_W},${plotTop}`
            }
          />
        ) : null,
      )}

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

      {/* course-reversal (procedure-turn) excursion left of the anchor fix */}
      {reversalGeom && (
        <CourseReversalExcursion
          reversal={reversalGeom.rev}
          anchorX={reversalGeom.anchorX}
          vertexX={reversalGeom.vertexX}
          entryY={reversalGeom.entryY}
          vertexY={reversalGeom.vertexY}
          rejoinY={reversalGeom.rejoinY}
        />
      )}

      {/* hold-in-lieu-of-PT racetrack segment left of its anchor fix */}
      {holdGeom && (
        <HoldInLieuFigure hold={holdGeom.hold} anchorX={holdGeom.anchorX} extLeft={holdGeom.extLeft} y={holdGeom.y} />
      )}

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

      {/* top band: fix names (+ inline DME chip), dashed vertical ticks down to the path */}
      {model.fixes.map((f, i) => {
        const x = xScale(f.distNm)
        const nameY = MARGIN.top + NAME_TOP_PAD + markerBandExtra + nameOffsets[i]
        const pathY = yScale(fixAlts[i])
        // Marker fix: lift the name by one line and put the marker type (OM/…)
        // on a second line centered under it, at the name's normal baseline.
        const nameBaselineY = f.marker ? nameY - MARKER_LABEL_H : nameY
        // IAF/IF role tag, drawn as a small line above the fix name. The course
        // reversal's anchor is tagged IAF too (the turn is entered there).
        const anchorIsIaf =
          model.courseReversal?.anchorIsIaf === true && i === model.courseReversal.anchorFixIdx
        const roleTag = f.role === 'iaf' || anchorIsIaf ? 'IAF' : f.role === 'if' ? 'IF' : null

        return (
          <g key={`name-${f.fixId}-${i}`}>
            <line className={styles.tick} x1={x} y1={nameY + 4} x2={x} y2={pathY} />

            {roleTag && (
              <text className={styles.roleTag} x={x} y={nameBaselineY - ROLE_TAG_H} textAnchor="middle">
                {roleTag}
              </text>
            )}
            <text className={styles.fixName} x={x} y={nameBaselineY} textAnchor="middle">
              {f.fixId}
              {f.speedKt > 0 && <tspan className={styles.speedInline}> {f.speedKt}K</tspan>}
            </text>
            {f.marker && (
              <text className={styles.markerType} x={x} y={nameY} textAnchor="middle">
                {f.markerLocator ? `L${f.marker}` : f.marker}
              </text>
            )}

            {/* Ident + DME chip inline, to the right of the fix name (reclaims
                the vertical row the stacked chip used to occupy). Vertically
                centered against the name's cap height. */}
            {f.dmeNm != null && (() => {
              const startX = x + nameHalfW(f) + DME_INLINE_GAP
              const ident = f.dmeNavaidId ? `${f.dmeNavaidId}${f.isDmeArc ? ' ARC' : ''}` : ''
              const identW = ident ? ident.length * DME_IDENT_CHAR_W + 3 : 0
              const glyphTop = nameBaselineY - 4.5 - (DME_H_PX * DME_SCALE) / 2
              return (
                <g>
                  {ident && (
                    <text className={styles.dmeIdent} x={startX} y={nameBaselineY} textAnchor="start">
                      {ident}
                    </text>
                  )}
                  <g transform={`translate(${startX + identW} ${glyphTop}) scale(${DME_SCALE})`}>
                    <DmeD nm={f.dmeNm} standalone={false} />
                  </g>
                </g>
              )
            })()}
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
            {/* Suppress the tiny PI barb / HF racetrack glyphs when the full
                course-reversal excursion or HILPT figure is drawn at this fix,
                so the maneuver isn't depicted twice. */}
            {hold &&
              !(hold.kind === 'PI' && reversalGeom) &&
              !(hold.kind === 'HF' && holdGeom && holdGeom.hold.anchorFixIdx === i) && (
                <HoldGlyph x={x} y={y} isPi={hold.kind === 'PI'} />
              )}
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
        // Wider min gap than the default 40px: labels scaled up with the glyph
        // (AIRCRAFT_GLYPH_SCALE) need more clearance to avoid overlapping.
        const labelSides = placeProfileLabels(liveAircraft, nmPerPx, 40 * AIRCRAFT_GLYPH_SCALE)
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
