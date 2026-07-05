import { useSettingsStore } from '../../store/useSettingsStore'
import styles from './ControlButton.module.css'

export function AirspaceToggle() {
  const { showAirspace, toggleAirspace } = useSettingsStore()

  return (
    <button
      className={`${styles.btn} ${showAirspace ? styles.active : ''}`}
      onClick={toggleAirspace}
      title={showAirspace ? 'Hide airspace (Class B/C/D/E)' : 'Show airspace (Class B/C/D/E)'}
      aria-label={showAirspace ? 'Hide airspace' : 'Show airspace'}
    >
      <svg
        className={styles.icon}
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Concentric "wedding cake" airspace rings, sectional-style. */}
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.1" />
        <circle cx="8" cy="8" r="4" stroke="currentColor" strokeWidth="1.1" strokeDasharray="1.6 1.4" />
        <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      </svg>
    </button>
  )
}
