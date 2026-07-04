import { useSettingsStore } from '../../store/useSettingsStore'
import styles from './ControlButton.module.css'

export function TerrainToggle() {
  const { showTerrain, toggleTerrain } = useSettingsStore()

  return (
    <button
      className={`${styles.btn} ${showTerrain ? styles.active : ''}`}
      onClick={toggleTerrain}
      title={showTerrain ? 'Hide terrain' : 'Show terrain'}
      aria-label={showTerrain ? 'Hide terrain' : 'Show terrain'}
    >
      <svg
        className={styles.icon}
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M1 13L5.5 6L8 9.5L10.5 5L15 13H1Z"
          fill="currentColor"
        />
        <path
          d="M10.5 5L9.6 6.4L10.5 6.9L11.4 6.4L10.5 5Z"
          fill="var(--input-bg)"
        />
      </svg>
    </button>
  )
}
