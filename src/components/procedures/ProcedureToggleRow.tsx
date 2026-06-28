import { useProcedureStore } from '../../store/useProcedureStore'
import type { Procedure } from '../../types/procedure'
import styles from './ProcedureToggleRow.module.css'

interface Props {
  procedure: Procedure
}

export function ProcedureToggleRow({ procedure }: Props) {
  const isVisible = useProcedureStore((s) => s.isVisible(procedure.id))
  const userToggle = useProcedureStore((s) => s.userToggles[procedure.id])
  const autoShown = useProcedureStore((s) => s.autoShownIds.has(procedure.id))
  const setUserToggle = useProcedureStore((s) => s.setUserToggle)
  const revertToAuto = useProcedureStore((s) => s.revertToAuto)

  const hasUserOverride = userToggle !== undefined

  return (
    <div className={`${styles.row} ${!procedure.hasGeometry ? styles.noGeom : ''}`}>
      <label className={styles.label}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={isVisible}
          onChange={(e) => setUserToggle(procedure.id, e.target.checked)}
        />
        <span
          className={styles.colorDot}
          style={{ background: procedure.color }}
        />
        <span className={styles.name}>{procedure.name}</span>
      </label>

      <div className={styles.badges}>
        {autoShown && !hasUserOverride && (
          <span className={styles.autoBadge} title="Auto-detected in use">AUTO</span>
        )}
        {!procedure.hasGeometry && (
          <span className={styles.warnBadge} title="No geometry available">!</span>
        )}
        {hasUserOverride && (
          <button
            className={styles.revertBtn}
            onClick={() => revertToAuto(procedure.id)}
            title="Revert to auto-visibility"
          >
            ↺
          </button>
        )}
      </div>
    </div>
  )
}
