import { useMapStore } from '../../store/useMapStore'
import { AXIS_ZOOM_STEP, AXIS_ZOOM_MAX_RATIO } from '../../config/constants'
import { formatStretchFactor } from '../../utils/axisZoom'
import styles from './AxisZoomControls.module.css'

/**
 * Per-axis zoom controls, styled to slot into the bottom-right stack with
 * PathControls/TrafficFilter. Each +/- zooms ONE screen axis, leaving the
 * other axis's scale untouched (e.g. zoom in horizontally to separate
 * parallel-runway traffic while keeping the full approach in view
 * vertically). The 1:1 button clears the stretch; while stretched it shows
 * which axis is zoomed in further and by what factor. Ordinary zoom
 * mechanics (wheel, pinch, double-click, the NavigationControl buttons)
 * always zoom both axes together, preserving the ratio.
 */
export function AxisZoomControls() {
  const axisRatio = useMapStore((s) => s.axisRatio)
  const adjustAxisZoom = useMapStore((s) => s.adjustAxisZoom)
  const resetAxisZoom = useMapStore((s) => s.resetAxisZoom)

  const atMax = axisRatio >= AXIS_ZOOM_MAX_RATIO
  const atMin = axisRatio <= -AXIS_ZOOM_MAX_RATIO

  return (
    <div className={styles.container} data-map-overlay="">
      <div className={styles.axisRow}>
        <span className={styles.axisLabel} aria-hidden="true">
          ↔
        </span>
        <button
          type="button"
          className={styles.btn}
          onClick={() => adjustAxisZoom('h', -AXIS_ZOOM_STEP)}
          disabled={atMax}
          title="Zoom out horizontally only"
          aria-label="Zoom out horizontal axis"
        >
          −
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={() => adjustAxisZoom('h', AXIS_ZOOM_STEP)}
          disabled={atMin}
          title="Zoom in horizontally only"
          aria-label="Zoom in horizontal axis"
        >
          +
        </button>
      </div>

      <div className={styles.axisRow}>
        <span className={styles.axisLabel} aria-hidden="true">
          ↕
        </span>
        <button
          type="button"
          className={styles.btn}
          onClick={() => adjustAxisZoom('v', -AXIS_ZOOM_STEP)}
          disabled={atMin}
          title="Zoom out vertically only"
          aria-label="Zoom out vertical axis"
        >
          −
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={() => adjustAxisZoom('v', AXIS_ZOOM_STEP)}
          disabled={atMax}
          title="Zoom in vertically only"
          aria-label="Zoom in vertical axis"
        >
          +
        </button>
      </div>

      <button
        type="button"
        className={`${styles.reset} ${axisRatio === 0 ? styles.resetIdle : ''}`}
        onClick={resetAxisZoom}
        disabled={axisRatio === 0}
        title={
          axisRatio === 0
            ? 'Both axes at the same zoom'
            : 'Reset to the same zoom on both axes'
        }
      >
        {axisRatio === 0 ? '1:1' : `${axisRatio > 0 ? '↕' : '↔'} ${formatStretchFactor(axisRatio)} · 1:1`}
      </button>
    </div>
  )
}
