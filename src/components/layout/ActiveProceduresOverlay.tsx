import { useProcedureStore } from '../../store/useProcedureStore'
import styles from './ActiveProceduresOverlay.module.css'

export function ActiveProceduresOverlay() {
  const procedures = useProcedureStore((s) => s.procedures)
  const autoShownIds = useProcedureStore((s) => s.autoShownIds)
  const userToggles = useProcedureStore((s) => s.userToggles)

  const active = procedures.filter(
    (p) => autoShownIds.has(p.id) || userToggles[p.id] === true,
  )

  if (active.length === 0) return null

  return (
    <div className={styles.overlay}>
      <div className={styles.title}>IN USE</div>
      {active.map((p) => (
        <div key={p.id} className={styles.item}>
          <span className={styles.dot} style={{ background: p.color }} />
          <span className={styles.name}>{p.name}</span>
          <span className={styles.badge}>{p.type}</span>
        </div>
      ))}
    </div>
  )
}
