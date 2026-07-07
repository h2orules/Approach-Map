import { usePaneStore } from '../../store/usePaneStore'
import { isOverProcedureLineBudget } from '../../utils/renderBudget'
import styles from './RenderBudgetHint.module.css'

interface Props {
  visibleCount: number
}

/**
 * Small dismissible banner shown over the map when the number of
 * simultaneously-visible procedure lines exceeds MAX_RENDERED_PROCEDURE_LINES
 * (~5 Mapbox layers each). Mirrors the AirportList clutter-hint pattern —
 * this never culls a procedure line, it only nudges the user to hide some.
 */
export function RenderBudgetHint({ visibleCount }: Props) {
  const dismissed = usePaneStore((s) => s.procedureLinesHintDismissed)
  const dismiss = usePaneStore((s) => s.dismissProcedureLinesHint)

  if (dismissed || !isOverProcedureLineBudget(visibleCount)) return null

  return (
    <div className={styles.hint} data-map-overlay="">
      <span className={styles.text}>
        {visibleCount} procedure lines visible — hide some or collapse airport sections to reduce clutter
      </span>
      <button className={styles.dismiss} onClick={dismiss} aria-label="Dismiss render budget hint">
        ×
      </button>
    </div>
  )
}
