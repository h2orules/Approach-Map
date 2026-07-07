import { useCallback } from 'react'
import { useMapStore } from '../../store/useMapStore'
import { useAirportStore, airportKey } from '../../store/useAirportStore'
import { DEFAULT_FLY_ZOOM } from '../../utils/decideFlyTarget'
import { ProcedureGroup } from '../procedures/ProcedureGroup'
import type { Airport } from '../../types/airport'
import type { Procedure } from '../../types/procedure'
import styles from './AirportSection.module.css'

interface Props {
  airport: Airport
  procedures: Procedure[]
  collapsed: boolean
  onToggle: () => void
}

export function AirportSection({ airport, procedures, collapsed, onToggle }: Props) {
  const key = airportKey(airport)
  const atis = useAirportStore((s) => s.atisByIcao[key])
  const removeAirport = useAirportStore((s) => s.removeAirport)
  const setViewport = useMapStore((s) => s.setViewport)

  const flyTo = useCallback(() => {
    setViewport({ longitude: airport.lon, latitude: airport.lat, zoom: DEFAULT_FLY_ZOOM })
  }, [airport, setViewport])

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      removeAirport(key)
    },
    [key, removeAirport],
  )

  const sids = procedures.filter((p) => p.type === 'SID')
  const stars = procedures.filter((p) => p.type === 'STAR')
  const approaches = procedures.filter((p) => p.type === 'APPROACH')
  const hasAtis = atis && atis.code !== '?'

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <button
          className={styles.chevronBtn}
          onClick={onToggle}
          aria-label={collapsed ? `Expand ${key}` : `Collapse ${key}`}
          aria-expanded={!collapsed}
        >
          <span className={styles.chevron}>{collapsed ? '›' : '⌄'}</span>
        </button>
        <button className={styles.ident} onClick={flyTo} title={`Fly to ${key}`}>
          {key}
        </button>
        <span className={styles.name} title={airport.name}>
          {airport.name}
        </span>
        {hasAtis && <span className={styles.atisBadge}>{atis!.code}</span>}
        <button
          className={styles.removeBtn}
          onClick={handleRemove}
          aria-label={`Remove ${key}`}
          title={`Remove ${key}`}
        >
          ×
        </button>
      </div>
      {!collapsed && (
        <div className={styles.body}>
          {procedures.length === 0 ? (
            <div className={styles.empty}>No procedures found</div>
          ) : (
            <>
              {sids.length > 0 && <ProcedureGroup type="SID" procedures={sids} />}
              {stars.length > 0 && <ProcedureGroup type="STAR" procedures={stars} />}
              {approaches.length > 0 && <ProcedureGroup type="APPROACH" procedures={approaches} />}
            </>
          )}
        </div>
      )}
    </div>
  )
}
