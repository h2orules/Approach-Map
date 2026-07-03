import { useRef, useState, useCallback } from 'react'
import { useProcedureStore } from '../../store/useProcedureStore'
import { useAirportStore } from '../../store/useAirportStore'
import { useAircraftStore } from '../../store/useAircraftStore'
import { useMapStore } from '../../store/useMapStore'
import { arrivalSummary } from '../../api/datis'
import styles from './ActiveProceduresOverlay.module.css'

function useHoverDelay(delayMs = 150) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const show = useCallback(() => { clearTimeout(timer.current); setOpen(true) }, [])
  const hide = useCallback(() => { timer.current = setTimeout(() => setOpen(false), delayMs) }, [delayMs])
  return { open, show, hide }
}

interface AircraftListProps {
  hexes: string[]
  onSelect: (hex: string) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function AircraftList({ hexes, onSelect, onMouseEnter, onMouseLeave }: AircraftListProps) {
  const aircraftMap = useAircraftStore((s) => s.aircraftMap)
  if (hexes.length === 0) return null
  return (
    <div className={styles.tooltip} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {hexes.map((hex) => {
        const ac = aircraftMap.get(hex)
        const label = ac ? (ac.flight?.trim() || ac.registration || hex.toUpperCase()) : hex.toUpperCase()
        return (
          <button key={hex} className={styles.callsign} onClick={() => onSelect(hex)}>
            {label}
          </button>
        )
      })}
    </div>
  )
}

export function ActiveProceduresOverlay() {
  const procedures = useProcedureStore((s) => s.procedures)
  const autoShownIds = useProcedureStore((s) => s.autoShownIds)
  const userToggles = useProcedureStore((s) => s.userToggles)
  const detectedHexes = useProcedureStore((s) => s.detectedHexes)
  const atisInfo = useAirportStore((s) => s.atisInfo)

  const setSelectedHex = useAircraftStore((s) => s.setSelectedHex)
  const setViewport = useMapStore((s) => s.setViewport)

  const atisHover = useHoverDelay()
  const [hoveredProcId, setHoveredProcId] = useState<string | null>(null)
  const procHideTimer = useRef<ReturnType<typeof setTimeout>>()

  const showProcTooltip = useCallback((id: string) => {
    clearTimeout(procHideTimer.current)
    setHoveredProcId(id)
  }, [])
  const hideProcTooltip = useCallback(() => {
    procHideTimer.current = setTimeout(() => setHoveredProcId(null), 150)
  }, [])

  const selectAircraft = useCallback((hex: string) => {
    const ac = useAircraftStore.getState().aircraftMap.get(hex)
    if (!ac) return
    setSelectedHex(hex)
    setViewport({ longitude: ac.interpLon, latitude: ac.interpLat, zoom: 13 })
  }, [setSelectedHex, setViewport])

  const active = procedures.filter(
    (p) => autoShownIds.has(p.id) || userToggles[p.id] === true,
  )

  if (active.length === 0) return null

  const hasAtis = atisInfo && atisInfo.code !== '?'
  const arrSummary = hasAtis ? arrivalSummary(atisInfo) : ''
  const depSummary = hasAtis && atisInfo.depRunways.length > 0
    ? atisInfo.depRunways.join(' ')
    : ''

  return (
    <div className={styles.overlay}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className={styles.title}>
        IN USE
        {hasAtis && (
          <span
            className={styles.atisBadge}
            onMouseEnter={atisHover.show}
            onMouseLeave={atisHover.hide}
          >
            ATIS {atisInfo.code}
          </span>
        )}
      </div>

      {/* ── ATIS approach/departure summary ────────────────────────── */}
      {hasAtis && (arrSummary || depSummary) && (
        <div
          className={styles.atisSection}
          onMouseEnter={atisHover.show}
          onMouseLeave={atisHover.hide}
        >
          {arrSummary && (
            <div className={styles.atisSummaryRow}>
              <span className={styles.atisLabel}>ARR</span>
              <span className={styles.atisValue}>{arrSummary}</span>
            </div>
          )}
          {depSummary && (
            <div className={styles.atisSummaryRow}>
              <span className={styles.atisLabel}>DEP</span>
              <span className={styles.atisValue}>{depSummary}</span>
            </div>
          )}
          {atisHover.open && (
            <div className={styles.atisFullText}>
              {atisInfo.raw}
            </div>
          )}
        </div>
      )}

      {/* ── Procedure list ─────────────────────────────────────────── */}
      {active.map((p) => {
        const hexes = detectedHexes[p.id] ?? []
        const isHovered = hoveredProcId === p.id
        return (
          <div
            key={p.id}
            className={styles.item}
            onMouseEnter={() => hexes.length > 0 && showProcTooltip(p.id)}
            onMouseLeave={hideProcTooltip}
          >
            <span className={styles.dot} style={{ background: p.color }} />
            <span className={styles.name}>{p.name}</span>
            <span className={styles.badge}>{p.type}</span>
            {isHovered && hexes.length > 0 && (
              <AircraftList
                hexes={hexes}
                onSelect={selectAircraft}
                onMouseEnter={() => clearTimeout(procHideTimer.current)}
                onMouseLeave={hideProcTooltip}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
