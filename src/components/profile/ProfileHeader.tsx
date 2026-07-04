import { useMemo } from 'react'
import type { Procedure } from '../../types/procedure'
import type { ProfileModel } from '../../geo/profileMath'
import { pickProfileTransition } from '../../geo/profileMath'
import { useCifpStore } from '../../services/cifpCache'
import { useDtppStore, getAmdtFor } from '../../services/dtppMetafile'
import { AIRAC_CYCLE_DAYS } from '../../config/constants'
import styles from './ProfilePanel.module.css'

interface Props {
  procedure: Procedure
  model: ProfileModel
}

const DATE_FMT: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: '2-digit' }

/** FAA-plate style "25 Jan 24" — day-month-year, matching chart date conventions. */
function formatEffDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { ...DATE_FMT, timeZone: 'UTC' })
}

export function ProfileHeader({ procedure, model }: Props) {
  // Subscribe to the chart data itself so the Amdt box fills in once the
  // d-TPP metafile finishes loading.
  const dtppByIcao = useDtppStore((s) => s.byIcao)
  const effectiveDateStr = useCifpStore((s) => s.effectiveDate)

  const validity = useMemo(() => {
    if (!effectiveDateStr) return null
    const start = new Date(effectiveDateStr)
    const end = new Date(start.getTime() + AIRAC_CYCLE_DAYS * 24 * 60 * 60 * 1000)
    return `Eff ${formatEffDate(start)} – ${formatEffDate(end)}`
  }, [effectiveDateStr])

  const amdt = useMemo(() => {
    void dtppByIcao
    return getAmdtFor(procedure.icao, procedure)
  }, [procedure, dtppByIcao])

  // Notes are computed from the transition's raw legs (not the merged
  // ProfileModel fixes) so DME/recommended-navaid pairing survives leg
  // grouping.
  const transition = useMemo(() => pickProfileTransition(procedure), [procedure])

  const isRnpAr = procedure.name.trim().toUpperCase().startsWith('H')
  const hasGs = model.tchFt != null || model.fixes.some((f) => f.isGsIntercept)
  const dmeRequired = (transition?.legs ?? []).some((l) => !!l.recNavId && l.dmeNm != null)
  const maxSpeed = Math.max(
    0,
    ...model.fixes.map((f) => f.speedKt),
    ...model.missed.map((f) => f.speedKt),
  )

  return (
    <div>
      <div className={styles.headerStrip}>
        <div className={styles.box}>
          <span className={styles.boxLabel}>Procedure</span>
          <span className={styles.boxValue}>
            {/* Prefer the official chart name once the d-TPP metafile is loaded */}
            {amdt?.chartName ??
              `${procedure.name}${procedure.runways.length > 0 ? ` RWY ${procedure.runways.join('/')}` : ''}`}{' '}
            · {procedure.icao}
          </span>
        </div>

        <div className={styles.box}>
          <span className={styles.boxLabel}>TDZE / RWY</span>
          <span className={styles.boxValue}>
            TDZE {model.tdzeFt != null ? model.tdzeFt.toLocaleString('en-US') : '—'}
            {'  '}
            RWY {model.runwayLengthFt != null ? model.runwayLengthFt.toLocaleString('en-US') : '—'}′
          </span>
        </div>

        <div className={styles.box}>
          <span className={styles.boxLabel}>Validity</span>
          <span className={styles.boxValue}>{validity ?? '—'}</span>
        </div>

        <div className={styles.box}>
          <span className={styles.boxLabel}>Amdt</span>
          <span className={styles.boxValue}>
            {amdt ? `Amdt ${amdt.amdt} · ${amdt.amdtDate}` : 'Amdt —'}
          </span>
        </div>
      </div>

      {(isRnpAr || hasGs || dmeRequired || maxSpeed > 0) && (
        <div className={styles.notesLine}>
          {isRnpAr && <span className={styles.chip}>RNP AR</span>}
          {hasGs && (
            <span>
              {`GS ${model.gsAngleDeg.toFixed(1)}°${model.usedFallbackGs ? '*' : ''}`}
              {model.tchFt != null ? ` · TCH ${model.tchFt}′` : ''}
            </span>
          )}
          {dmeRequired && <span className={styles.chip}>DME REQUIRED</span>}
          {maxSpeed > 0 && <span>Max {maxSpeed}KT</span>}
        </div>
      )}
    </div>
  )
}
