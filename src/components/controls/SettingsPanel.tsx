import { useSettingsStore } from '../../store/useSettingsStore'
import styles from './SettingsPanel.module.css'

export function SettingsPanel() {
  const {
    pollIntervalMs,
    setPollInterval,
    searchRadiusNm,
    setSearchRadius,
    showExtendedCenterlines,
    toggleExtendedCenterlines,
    extendedCenterlineLengthNm,
    setCenterlineLength,
  } = useSettingsStore()

  return (
    <div className={styles.panel}>
      <div className={styles.sectionTitle}>Settings</div>

      <label className={styles.row}>
        <span className={styles.label}>Update interval</span>
        <select
          className={styles.select}
          value={pollIntervalMs}
          onChange={(e) => setPollInterval(Number(e.target.value))}
        >
          <option value={2000}>2s</option>
          <option value={5000}>5s</option>
          <option value={10000}>10s</option>
          <option value={30000}>30s</option>
        </select>
      </label>

      <label className={styles.row}>
        <span className={styles.label}>Search radius</span>
        <select
          className={styles.select}
          value={searchRadiusNm}
          onChange={(e) => setSearchRadius(Number(e.target.value))}
        >
          <option value={25}>25 nm</option>
          <option value={50}>50 nm</option>
          <option value={100}>100 nm</option>
          <option value={150}>150 nm</option>
        </select>
      </label>

      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={showExtendedCenterlines}
          onChange={toggleExtendedCenterlines}
          className={styles.checkbox}
        />
        <span>Extended centerlines</span>
      </label>

      {showExtendedCenterlines && (
        <label className={styles.row}>
          <span className={styles.label}>Length</span>
          <select
            className={styles.select}
            value={extendedCenterlineLengthNm}
            onChange={(e) => setCenterlineLength(Number(e.target.value))}
          >
            <option value={5}>5 nm</option>
            <option value={10}>10 nm</option>
            <option value={15}>15 nm</option>
            <option value={25}>25 nm</option>
          </select>
        </label>
      )}
    </div>
  )
}
