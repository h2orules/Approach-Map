import { useRef, useState, useCallback } from 'react'
import { useProcedureStore } from '../../store/useProcedureStore'
import { useAircraftStore } from '../../store/useAircraftStore'
import { useSelectionStore } from '../../store/useSelectionStore'
import { useMapStore } from '../../store/useMapStore'
import { AUTO_HIDE_DELAY_MS } from '../../config/constants'
import type { Procedure } from '../../types/procedure'
import styles from './ProcedureToggleRow.module.css'

interface Props {
  procedure: Procedure
}

function formatRemaining(lastSeenMs: number | undefined): string | null {
  if (!lastSeenMs) return null
  const remainingMs = lastSeenMs + AUTO_HIDE_DELAY_MS - Date.now()
  if (remainingMs <= 0) return null
  const roundedMs = Math.ceil(remainingMs / 15000) * 15000
  const totalS = Math.round(roundedMs / 1000)
  const m = Math.floor(totalS / 60)
  const s = totalS % 60
  return m > 0 ? `~${m}m ${s}s` : `~${s}s`
}

export function ProcedureToggleRow({ procedure }: Props) {
  const isVisible = useProcedureStore((s) => s.isVisible(procedure.id))
  const userToggle = useProcedureStore((s) => s.userToggles[procedure.id])
  const autoShown = useProcedureStore((s) => s.autoShownIds.has(procedure.id))
  const detectedHexes = useProcedureStore((s) => s.detectedHexes[procedure.id] ?? [])
  const lastDetectedAt = useProcedureStore((s) => s.lastDetectedAt[procedure.id])
  const setUserToggle = useProcedureStore((s) => s.setUserToggle)
  const revertToAuto = useProcedureStore((s) => s.revertToAuto)
  const aircraftMap = useAircraftStore((s) => s.aircraftMap)
  const selected = useSelectionStore((s) => s.selected)
  const selectAircraftSel = useSelectionStore((s) => s.select)
  const toggleSelection = useSelectionStore((s) => s.toggle)
  const setViewport = useMapStore((s) => s.setViewport)

  const isApproach = procedure.type === 'APPROACH'
  const isSelected = selected?.kind === 'approach' && selected.procedureId === procedure.id
  const hasUserOverride = userToggle !== undefined
  const badgeRef = useRef<HTMLSpanElement>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>()

  const showTooltip = useCallback(() => {
    clearTimeout(hideTimer.current)
    if (badgeRef.current) {
      const rect = badgeRef.current.getBoundingClientRect()
      const x = rect.right + 8
      // Clamp y so the tooltip doesn't slip off the bottom of the viewport.
      const y = Math.min(rect.top - 2, window.innerHeight - 120)
      setTooltipPos({ x, y })
    }
  }, [])

  const hideTooltip = useCallback(() => {
    hideTimer.current = setTimeout(() => setTooltipPos(null), 150)
  }, [])

  const keepTooltip = useCallback(() => clearTimeout(hideTimer.current), [])

  const selectAircraft = useCallback((hex: string) => {
    const ac = useAircraftStore.getState().aircraftMap.get(hex)
    if (!ac) return
    selectAircraftSel({ kind: 'aircraft', hex })
    setViewport({ longitude: ac.interpLon, latitude: ac.interpLat, zoom: 13 })
    setTooltipPos(null)
  }, [selectAircraftSel, setViewport])

  const remaining = formatRemaining(lastDetectedAt)

  // Selecting a hidden approach also shows it — otherwise the selection
  // guards would clear the selection immediately (a selected approach must
  // stay visible) and the click would appear to do nothing.
  const handleNameClick = useCallback(() => {
    if (!isSelected && !isVisible) setUserToggle(procedure.id, true)
    toggleSelection({ kind: 'approach', procedureId: procedure.id })
  }, [isSelected, isVisible, procedure.id, setUserToggle, toggleSelection])

  return (
    <div className={`${styles.row} ${!procedure.hasGeometry ? styles.noGeom : ''}`}>
      <label className={styles.label}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={isVisible}
          onChange={(e) => setUserToggle(procedure.id, e.target.checked)}
        />
      </label>

      <span
        className={styles.colorDot}
        style={{ background: procedure.color }}
      />
      <span
        className={`${styles.name} ${isApproach ? styles.nameSelectable : ''} ${isSelected ? styles.nameSelected : ''}`}
        onClick={isApproach ? handleNameClick : undefined}
      >
        {procedure.name}
      </span>

      <div className={styles.badges}>
        {autoShown && !hasUserOverride && (
          <span
            ref={badgeRef}
            className={styles.autoBadge}
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
      {tooltipPos && (
        <div
          className={styles.tooltip}
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
          onMouseEnter={keepTooltip}
          onMouseLeave={hideTooltip}
        >
          {detectedHexes.length > 0 ? (
            detectedHexes.map((hex) => {
              const ac = aircraftMap.get(hex)
              const label = ac
                ? (ac.flight?.trim() || ac.registration || hex.toUpperCase())
                : hex.toUpperCase()
              return (
                <button key={hex} className={styles.callsign} onClick={() => selectAircraft(hex)}>
                  {label}
                </button>
              )
            })
          ) : (
            <>
              <span className={styles.noPlanes}>No active planes.</span>
              {remaining && <span className={styles.noPlanesSub}>Hides in {remaining}</span>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
