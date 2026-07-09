import { useAirportStore, airportKey } from '../../store/useAirportStore'
import { useProcedureStore } from '../../store/useProcedureStore'
import { usePaneStore } from '../../store/usePaneStore'
import { MAX_ACTIVE_AIRPORTS_SOFT } from '../../config/constants'
import { AirportSection } from './AirportSection'
import styles from './AirportList.module.css'

interface Props {
  sectionCollapsed: Record<string, boolean>
  onToggleSection: (key: string) => void
}

export function AirportList({ sectionCollapsed, onToggleSection }: Props) {
  const activeAirports = useAirportStore((s) => s.activeAirports)
  const procedures = useProcedureStore((s) => s.procedures)
  const loading = useProcedureStore((s) => s.loading)
  const clutterHintDismissed = usePaneStore((s) => s.clutterHintDismissed)
  const dismissClutterHint = usePaneStore((s) => s.dismissClutterHint)

  if (activeAirports.length === 0) {
    return (
      <div className={styles.empty}>
        <p>Select an airport to view procedures</p>
      </div>
    )
  }

  const showClutterHint = activeAirports.length >= MAX_ACTIVE_AIRPORTS_SOFT && !clutterHintDismissed

  return (
    <div className={styles.list}>
      {showClutterHint && (
        <div className={styles.clutterHint}>
          <span className={styles.clutterHintText}>
            Many airports active — consider removing some to reduce clutter
          </span>
          <button
            className={styles.clutterHintDismiss}
            onClick={dismissClutterHint}
            aria-label="Dismiss clutter hint"
          >
            ×
          </button>
        </div>
      )}
      {loading && <div className={styles.loading}>Loading…</div>}
      {activeAirports.map((airport) => {
        const key = airportKey(airport)
        const airportProcedures = procedures.filter((p) => p.icao.toUpperCase() === key)
        return (
          <AirportSection
            key={key}
            airport={airport}
            procedures={airportProcedures}
            collapsed={sectionCollapsed[key] ?? false}
            onToggle={() => onToggleSection(key)}
          />
        )
      })}
    </div>
  )
}
