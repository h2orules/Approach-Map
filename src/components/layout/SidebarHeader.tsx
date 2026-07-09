import type { PaneMode } from '../../store/usePaneStore'
import styles from './SidebarHeader.module.css'

interface Props {
  mode: PaneMode
  expanded: boolean
  onToggleExpanded: () => void
  count: number
  showBulkActions: boolean
  onCollapseAll: () => void
  onExpandAll: () => void
}

/**
 * Fixed header row: desktop/tablet renders it as the 36px sidebar header
 * (reopen/collapse chevron + "N AIRPORTS" + optional collapse/expand-all);
 * phone renders the same information as the always-visible 44px bottom-sheet
 * handle bar (drag-handle pill, tap-anywhere-to-toggle).
 */
export function SidebarHeader({
  mode,
  expanded,
  onToggleExpanded,
  count,
  showBulkActions,
  onCollapseAll,
  onExpandAll,
}: Props) {
  const label = `${count} ${count === 1 ? 'AIRPORT' : 'AIRPORTS'}`

  if (mode === 'overlay') {
    return (
      <button
        className={styles.handle}
        onClick={onToggleExpanded}
        aria-label={expanded ? 'Collapse airports panel' : 'Expand airports panel'}
        aria-expanded={expanded}
      >
        <span className={styles.grip} aria-hidden="true" />
        <span className={styles.handleRow}>
          <span className={styles.count}>{label}</span>
          <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`} aria-hidden="true">
            ⌄
          </span>
        </span>
      </button>
    )
  }

  const isRailCollapsed = !expanded

  return (
    <div className={styles.header}>
      <button
        className={styles.chevronBtn}
        onClick={onToggleExpanded}
        aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-expanded={expanded}
        title={expanded ? 'Collapse sidebar (Ctrl/Cmd+B)' : 'Expand sidebar (Ctrl/Cmd+B)'}
      >
        <span className={styles.chevron}>{expanded ? '‹' : '›'}</span>
      </button>
      {!isRailCollapsed && (
        <>
          <span className={styles.count}>{label}</span>
          {showBulkActions && (
            <div className={styles.bulkActions}>
              <button className={styles.bulkBtn} onClick={onCollapseAll}>
                Collapse all
              </button>
              <button className={styles.bulkBtn} onClick={onExpandAll}>
                Expand all
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
