import { AirportSearch } from '../airport/AirportSearch'
import { MapStyleToggle } from '../controls/MapStyleToggle'
import { ThemeToggle } from '../controls/ThemeToggle'
import { CifpStatusBanner } from './CifpStatusBanner'
import styles from './TopBar.module.css'

export function TopBar() {
  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>Approach Map</div>
      <div className={styles.center}>
        <AirportSearch />
      </div>
      <div className={styles.controls}>
        <ThemeToggle />
        <MapStyleToggle />
      </div>
      <CifpStatusBanner />
    </header>
  )
}
