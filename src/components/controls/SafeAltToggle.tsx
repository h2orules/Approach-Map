import { useSettingsStore } from '../../store/useSettingsStore'
import styles from './ControlButton.module.css'

export function SafeAltToggle() {
  const { showSafeAltitudes, toggleSafeAltitudes } = useSettingsStore()

  return (
    <button
      className={`${styles.btn} ${showSafeAltitudes ? styles.active : ''}`}
      onClick={toggleSafeAltitudes}
      title={showSafeAltitudes ? 'Hide TAA/MSA safe altitudes' : 'Show TAA/MSA safe altitudes'}
      aria-label={showSafeAltitudes ? 'Hide TAA/MSA safe altitudes' : 'Show TAA/MSA safe altitudes'}
    >
      <svg
        className={styles.icon}
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 8L8 2A6 6 0 0 1 11 2.8Z" fill="currentColor" />
      </svg>
    </button>
  )
}
