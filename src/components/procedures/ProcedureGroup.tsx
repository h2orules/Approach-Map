import { useState } from 'react'
import type { Procedure, ProcedureType } from '../../types/procedure'
import { ProcedureToggleRow } from './ProcedureToggleRow'
import styles from './ProcedureGroup.module.css'

const TYPE_LABELS: Record<ProcedureType, string> = {
  SID: 'Departures (SID)',
  STAR: 'Arrivals (STAR)',
  APPROACH: 'Approaches (IAP)',
}

interface Props {
  type: ProcedureType
  procedures: Procedure[]
}

export function ProcedureGroup({ type, procedures }: Props) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className={styles.group}>
      <button
        className={styles.groupHeader}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span>{TYPE_LABELS[type]}</span>
        <span className={styles.count}>{procedures.length}</span>
        <span className={styles.chevron}>{collapsed ? '›' : '⌄'}</span>
      </button>
      {!collapsed && (
        <div>
          {procedures.map((p) => (
            <ProcedureToggleRow key={p.id} procedure={p} />
          ))}
        </div>
      )}
    </div>
  )
}
