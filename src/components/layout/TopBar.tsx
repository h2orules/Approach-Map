import { AirportSearch } from '../airport/AirportSearch'
import { MapStyleToggle } from '../controls/MapStyleToggle'
import { SafeAltToggle } from '../controls/SafeAltToggle'
import { MvaToggle } from '../controls/MvaToggle'
import { AirspaceToggle } from '../controls/AirspaceToggle'
import { TerrainToggle } from '../controls/TerrainToggle'
import { ThemeToggle } from '../controls/ThemeToggle'
import { CifpStatusBanner } from './CifpStatusBanner'
import { NotForNavigation } from './NotForNavigation'
import styles from './TopBar.module.css'

export function TopBar() {
  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>
        {/* Collapses to "AM" on phones to free top-bar space for controls. */}
        <span className={styles.brandFull}>Approach Map</span>
        <span className={styles.brandShort} aria-hidden="true">
          AM
        </span>
      </div>
      <div className={styles.center}>
        <AirportSearch />
      </div>
      <div className={styles.controls}>
        <ThemeToggle />
        <MapStyleToggle />
        <TerrainToggle />
        <SafeAltToggle />
        <MvaToggle />
        <AirspaceToggle />
      </div>
      <CifpStatusBanner />
      <NotForNavigation />
    </header>
  )
}
