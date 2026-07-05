import { useSettingsStore } from '../../store/useSettingsStore'
import styles from './TrafficFilter.module.css'

/**
 * Two show/hide toggles for traffic categories, stacked just above the
 * AltitudeFilter and styled to match it. TIS-B = radar-rebroadcast targets
 * (hex prefixed '~'); VFR = squawking 1200. Both default to shown; toggling
 * takes effect immediately via the AircraftOverlay RAF loop (same imperative
 * show/hide path as the altitude filter).
 */
export function TrafficFilter() {
  const showTisb = useSettingsStore((s) => s.showTisb)
  const showVfr = useSettingsStore((s) => s.showVfr)
  const toggleTisb = useSettingsStore((s) => s.toggleTisb)
  const toggleVfr = useSettingsStore((s) => s.toggleVfr)

  return (
    <div className={styles.container} data-map-overlay="">
      <button
        type="button"
        className={`${styles.toggle} ${showTisb ? '' : styles.off}`}
        onClick={toggleTisb}
        title={showTisb ? 'Hide TIS-B (radar-rebroadcast) targets' : 'Show TIS-B (radar-rebroadcast) targets'}
        aria-pressed={showTisb}
      >
        <span className={`${styles.dot} ${styles.dotTisb}`} />
        TIS-B
      </button>
      <button
        type="button"
        className={`${styles.toggle} ${showVfr ? '' : styles.off}`}
        onClick={toggleVfr}
        title={showVfr ? 'Hide VFR traffic (squawk 1200)' : 'Show VFR traffic (squawk 1200)'}
        aria-pressed={showVfr}
      >
        <span className={`${styles.dot} ${styles.dotVfr}`} />
        VFR
      </button>
    </div>
  )
}
