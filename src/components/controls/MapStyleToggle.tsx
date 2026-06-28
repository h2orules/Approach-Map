import { useMapStore } from '../../store/useMapStore'
import styles from './ControlButton.module.css'

export function MapStyleToggle() {
  const { satelliteOn, toggleSatellite } = useMapStore()

  return (
    <button
      className={`${styles.btn} ${satelliteOn ? styles.active : ''}`}
      onClick={toggleSatellite}
      title={satelliteOn ? 'Switch to vector map' : 'Switch to satellite'}
    >
      SAT
    </button>
  )
}
