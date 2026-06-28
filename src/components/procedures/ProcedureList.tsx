import { useProcedureStore } from '../../store/useProcedureStore'
import { useAirportStore } from '../../store/useAirportStore'
import { ProcedureGroup } from './ProcedureGroup'
import styles from './ProcedureList.module.css'

export function ProcedureList() {
  const selectedAirport = useAirportStore((s) => s.selectedAirport)
  const procedures = useProcedureStore((s) => s.procedures)
  const loading = useProcedureStore((s) => s.loading)

  const sids = procedures.filter((p) => p.type === 'SID')
  const stars = procedures.filter((p) => p.type === 'STAR')
  const approaches = procedures.filter((p) => p.type === 'APPROACH')

  if (!selectedAirport) {
    return (
      <div className={styles.empty}>
        <p>Select an airport to view procedures</p>
      </div>
    )
  }

  return (
    <div className={styles.list}>
      <div className={styles.header}>{selectedAirport.icao} Procedures</div>
      {loading && <div className={styles.loading}>Loading…</div>}
      {!loading && procedures.length === 0 && (
        <div className={styles.empty}>No procedures found</div>
      )}
      {sids.length > 0 && <ProcedureGroup type="SID" procedures={sids} />}
      {stars.length > 0 && <ProcedureGroup type="STAR" procedures={stars} />}
      {approaches.length > 0 && <ProcedureGroup type="APPROACH" procedures={approaches} />}
    </div>
  )
}
