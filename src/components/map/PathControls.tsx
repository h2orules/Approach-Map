import { useSettingsStore } from '../../store/useSettingsStore'
import { PREDICTION_MINUTES_OPTIONS } from '../../config/constants'
import styles from './PathControls.module.css'

/**
 * Bottom-right control cluster for the path-prediction engine, styled to
 * match TrafficFilter so it slots into the same stack. PRED toggles
 * predicted-path lines on/off; the 1'/2'/3'/5' segmented group picks how far
 * ahead they extend (dimmed and disabled while PRED is off); RINGS toggles
 * range rings around the selected aircraft.
 */
export function PathControls() {
  const showPredictedPaths = useSettingsStore((s) => s.showPredictedPaths)
  const predictionMinutes = useSettingsStore((s) => s.predictionMinutes)
  const showRangeRings = useSettingsStore((s) => s.showRangeRings)
  const togglePredictedPaths = useSettingsStore((s) => s.togglePredictedPaths)
  const setPredictionMinutes = useSettingsStore((s) => s.setPredictionMinutes)
  const toggleRangeRings = useSettingsStore((s) => s.toggleRangeRings)

  return (
    <div className={styles.container} data-map-overlay="">
      <button
        type="button"
        className={`${styles.toggle} ${showPredictedPaths ? '' : styles.off}`}
        onClick={togglePredictedPaths}
        title={showPredictedPaths ? 'Hide predicted flight paths' : 'Show predicted flight paths'}
        aria-pressed={showPredictedPaths}
      >
        <span className={`${styles.dot} ${styles.dotPred}`} />
        PRED
      </button>

      <div className={`${styles.segmented} ${showPredictedPaths ? '' : styles.segmentedOff}`}>
        {PREDICTION_MINUTES_OPTIONS.map((m) => (
          <button
            key={m}
            type="button"
            className={`${styles.segment} ${predictionMinutes === m ? styles.segmentActive : ''}`}
            onClick={() => setPredictionMinutes(m)}
            disabled={!showPredictedPaths}
            title={`Predict ${m} minute${m === 1 ? '' : 's'} ahead`}
            aria-pressed={predictionMinutes === m}
          >
            {m}&apos;
          </button>
        ))}
      </div>

      <button
        type="button"
        className={`${styles.toggle} ${showRangeRings ? '' : styles.off}`}
        onClick={toggleRangeRings}
        title={showRangeRings ? 'Hide range rings' : 'Show range rings around the selected aircraft'}
        aria-pressed={showRangeRings}
      >
        <span className={`${styles.dot} ${styles.dotRings}`} />
        RINGS
      </button>
    </div>
  )
}
