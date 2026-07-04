import { useCallback, useRef, useState } from 'react'
import { useSettingsStore } from '../../store/useSettingsStore'
import {
  NUM_POSITIONS,
  positionLabel,
  positionToMinFt,
  positionToMaxFt,
} from '../../utils/altitudeFilter'
import styles from './AltitudeFilter.module.css'

const MAX_POS = NUM_POSITIONS - 1  // 19

/** Total height of the slider track div in px (includes handle clearance). */
const TOTAL_HEIGHT = 224
/** Padding at top and bottom so handles don't clip the track edges. */
const PADDING = 8
/** Distance between the two extreme handle snap positions. */
const TRACK_HEIGHT = TOTAL_HEIGHT - 2 * PADDING

/** Tick positions to display labels and marks for (every 3k + special snaps). */
const TICKS = [0, 3, 6, 9, 12, 15, 18, 19] as const

/** Convert a slider position (0–19) to a CSS top value inside the track div. */
function posToY(pos: number): number {
  return PADDING + (1 - pos / MAX_POS) * TRACK_HEIGHT
}

/** Convert a CSS y offset (from track top) to the nearest valid position. */
function yToPos(y: number): number {
  const clamped = Math.max(PADDING, Math.min(TOTAL_HEIGHT - PADDING, y))
  const frac = (clamped - PADDING) / TRACK_HEIGHT
  return Math.max(0, Math.min(MAX_POS, Math.round((1 - frac) * MAX_POS)))
}

export function AltitudeFilter() {
  const altMin = useSettingsStore((s) => s.altFilterMin)
  const altMax = useSettingsStore((s) => s.altFilterMax)
  const setAltFilterMin = useSettingsStore((s) => s.setAltFilterMin)
  const setAltFilterMax = useSettingsStore((s) => s.setAltFilterMax)

  const trackRef = useRef<HTMLDivElement>(null)
  // Which handle is being dragged; null when idle.
  const dragging = useRef<'min' | 'max' | null>(null)
  // Drives the tooltip and dragging class — separate from ref so React re-renders.
  const [dragState, setDragState] = useState<{ which: 'min' | 'max'; pos: number } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent, which: 'min' | 'max') => {
      e.preventDefault()
      e.stopPropagation()
      dragging.current = which
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      setDragState({ which, pos: which === 'min' ? altMin : altMax })
    },
    [altMin, altMax],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current || !trackRef.current) return
      const rect = trackRef.current.getBoundingClientRect()
      const pos = yToPos(e.clientY - rect.top)
      const { altFilterMin, altFilterMax } = useSettingsStore.getState()

      if (dragging.current === 'min') {
        const clamped = Math.min(pos, altFilterMax - 1)
        setAltFilterMin(clamped)
        setDragState({ which: 'min', pos: clamped })
      } else {
        const clamped = Math.max(pos, altFilterMin + 1)
        setAltFilterMax(clamped)
        setDragState({ which: 'max', pos: clamped })
      }
    },
    [setAltFilterMin, setAltFilterMax],
  )

  const onPointerUp = useCallback(() => {
    dragging.current = null
    setDragState(null)
  }, [])

  const fillTop = posToY(altMax)
  const fillHeight = posToY(altMin) - posToY(altMax)

  const isDefault = altMin === 0 && altMax === MAX_POS

  const tooltipText = dragState
    ? dragState.which === 'min'
      ? positionLabel(dragState.pos) +
        (positionToMinFt(dragState.pos) === 0
          ? ''
          : ` (${(positionToMinFt(dragState.pos) / 1000).toFixed(0)}k ft)`)
      : positionLabel(dragState.pos) +
        (dragState.pos === MAX_POS
          ? ' (60k ft)'
          : ` (${(positionToMaxFt(dragState.pos) / 1000).toFixed(0)}k ft)`)
    : null

  return (
    <div className={styles.container} data-map-overlay="">
      {/* Summary badge: shown when filter is non-default */}
      {!isDefault && (
        <div className={styles.summary}>
          {positionLabel(altMin)}–{positionLabel(altMax)}
        </div>
      )}

      {/* Inner row: labels column + track column */}
      <div className={styles.inner}>
        {/* Tick labels */}
        <div className={styles.labelsCol} style={{ height: TOTAL_HEIGHT }}>
          {TICKS.map((pos) => (
            <span
              key={pos}
              className={`${styles.tickLabel} ${pos >= 18 ? styles.tickLabelSpecial : ''}`}
              style={{ top: posToY(pos) }}
            >
              {positionLabel(pos)}
            </span>
          ))}
        </div>

        {/* Track (rail + fill + ticks + handles) */}
        <div
          ref={trackRef}
          className={styles.track}
          style={{ height: TOTAL_HEIGHT }}
        >
          <div className={styles.rail} />

          <div className={styles.fill} style={{ top: fillTop, height: fillHeight }} />

          {TICKS.map((pos) => (
            <div
              key={pos}
              className={`${styles.tickMark} ${pos >= 18 ? styles.tickMarkSpecial : ''}`}
              style={{ top: posToY(pos) }}
            />
          ))}

          {/* Min handle */}
          <div
            className={`${styles.handle} ${dragState?.which === 'min' ? styles.handleDragging : ''}`}
            style={{ top: posToY(altMin) }}
            onPointerDown={(e) => onPointerDown(e, 'min')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />

          {/* Max handle */}
          <div
            className={`${styles.handle} ${dragState?.which === 'max' ? styles.handleDragging : ''}`}
            style={{ top: posToY(altMax) }}
            onPointerDown={(e) => onPointerDown(e, 'max')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>

        {/* Drag tooltip — floats to the LEFT of the inner widget */}
        {dragState && tooltipText && (
          <div
            className={styles.tooltip}
            style={{ top: posToY(dragState.pos) }}
          >
            {tooltipText}
          </div>
        )}
      </div>
    </div>
  )
}
