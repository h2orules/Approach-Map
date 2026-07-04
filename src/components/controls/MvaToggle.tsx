import { useSettingsStore } from '../../store/useSettingsStore'
import styles from './ControlButton.module.css'

export function MvaToggle() {
  const { showMva, toggleMva } = useSettingsStore()

  return (
    <button
      className={`${styles.btn} ${showMva ? styles.active : ''}`}
      onClick={toggleMva}
      title={showMva ? 'Hide minimum vectoring altitudes' : 'Show minimum vectoring altitudes'}
      aria-label={showMva ? 'Hide minimum vectoring altitudes' : 'Show minimum vectoring altitudes'}
    >
      <svg
        className={styles.icon}
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Overlapping irregular MVA-sector outlines, radar-chart style. */}
        <path d="M8 1L14 5L12.5 12L4 13.5L2 6.5Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
        <path d="M8 5L11 7L10 11L6.5 11.8L5.2 8Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
