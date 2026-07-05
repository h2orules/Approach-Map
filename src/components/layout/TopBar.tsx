import { AirportSearch } from '../airport/AirportSearch'
import { MapStyleToggle } from '../controls/MapStyleToggle'
import { SafeAltToggle } from '../controls/SafeAltToggle'
import { MvaToggle } from '../controls/MvaToggle'
import { AirspaceToggle } from '../controls/AirspaceToggle'
import { TerrainToggle } from '../controls/TerrainToggle'
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
        <TerrainToggle />
        <SafeAltToggle />
        <MvaToggle />
        <AirspaceToggle />
      </div>
      <CifpStatusBanner />
    </header>
  )
}
