import { useRef, useState, useCallback } from 'react'
import { useProcedureStore } from '../../store/useProcedureStore'
import { useAircraftStore } from '../../store/useAircraftStore'
import { useMapStore } from '../../store/useMapStore'
import type { Procedure } from '../../types/procedure'
import styles from './ProcedureToggleRow.module.css'

interface Props {
  procedure: Procedure
}

export function ProcedureToggleRow({ procedure }: Props) {
  const isVisible = useProcedureStore((s) => s.isVisible(procedure.id))
  const userToggle = useProcedureStore((s) => s.userToggles[procedure.id])
  const autoShown = useProcedureStore((s) => s.autoShownIds.has(procedure.id))
  const detectedHexes = useProcedureStore((s) => s.detectedHexes[procedure.id] ?? [])
  const setUserToggle = useProcedureStore((s) => s.setUserToggle)
  const revertToAuto = useProcedureStore((s) => s.revertToAuto)
  const aircraftMap = useAircraftStore((s) => s.aircraftMap)
  const setSelectedHex = useAircraftStore((s) => s.setSelectedHex)
  const setViewport = useMapStore((s) => s.setViewport)

  const hasUserOverride = userToggle !== undefined
  const badgeRef = useRef<HTMLSpanElement>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>()

  const showTooltip = useCallback(() => {
    if (detectedHexes.length === 0) return
    clearTimeout(hideTimer.current)
    if (badgeRef.current) {
      const rect = badgeRef.current.getBoundingClientRect()
      setTooltipPos({ x: rect.right + 8, y: rect.top - 2 })
    }
  }, [detectedHexes.length])

  const hideTooltip = useCallback(() => {
    hideTimer.current = setTimeout(() => setTooltipPos(null), 150)
  }, [])

  const keepTooltip = useCallback(() => clearTimeout(hideTimer.current), [])

  const selectAircraft = useCallback((hex: string) => {
    const ac = useAircraftStore.getState().aircraftMap.get(hex)
    if (!ac) return
    setSelectedHex(hex)
    setViewport({ longitude: ac.interpLon, latitude: ac.interpLat, zoom: 13 })
    setTooltipPos(null)
  }, [setSelectedHex, setViewport])

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
          <span
            ref={badgeRef}
            className={styles.autoBadge}
            title={detectedHexes.length > 0 ? undefined : 'Auto-detected in use'}
            onMouseEnter={showTooltip}
            onMouseLeave={hideTooltip}
          >
            AUTO
          </span>
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

      {/* Fixed-position tooltip so it escapes the sidebar overflow:hidden */}
      {tooltipPos && detectedHexes.length > 0 && (
        <div
          className={styles.tooltip}
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
          onMouseEnter={keepTooltip}
          onMouseLeave={hideTooltip}
        >
          {detectedHexes.map((hex) => {
            const ac = aircraftMap.get(hex)
            const label = ac
              ? (ac.flight?.trim() || ac.registration || hex.toUpperCase())
              : hex.toUpperCase()
            return (
              <button key={hex} className={styles.callsign} onClick={() => selectAircraft(hex)}>
                {label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
