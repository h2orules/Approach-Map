import { useMapStore } from '../../store/useMapStore'
import styles from './ControlButton.module.css'

export function MapStyleToggle() {
  const { satelliteOn, toggleSatellite } = useMapStore()

  return (
    <button
      className={`${styles.btn} ${satelliteOn ? styles.active : ''}`}
      onClick={toggleSatellite}
      title={satelliteOn ? 'Switch to vector map' : 'Switch to satellite'}
      aria-label={satelliteOn ? 'Switch to vector map' : 'Switch to satellite'}
    >
      <svg
        className={styles.icon}
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g transform="rotate(-45 8 8)">
          <rect x="1" y="7" width="3.4" height="2" rx="0.3" fill="currentColor" />
          <rect x="11.6" y="7" width="3.4" height="2" rx="0.3" fill="currentColor" />
          <rect x="6.8" y="6.3" width="2.4" height="3.4" rx="0.4" fill="currentColor" />
          <path d="M8 6.3V4.3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <circle cx="8" cy="3.8" r="0.7" fill="currentColor" />
        </g>
      </svg>
    </button>
  )
}
