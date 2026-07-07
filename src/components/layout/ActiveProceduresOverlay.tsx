import { useRef, useState, useCallback } from 'react'
import clsx from 'clsx'
import { useProcedureStore } from '../../store/useProcedureStore'
import { useAirportStore, airportKey } from '../../store/useAirportStore'
import { useAircraftStore } from '../../store/useAircraftStore'
import { useSelectionStore } from '../../store/useSelectionStore'
import { useMapStore } from '../../store/useMapStore'
import { arrivalSummary, type AtisInfo } from '../../api/datis'
import { AUTO_HIDE_DELAY_MS } from '../../config/constants'
import type { Procedure } from '../../types/procedure'
import styles from './ActiveProceduresOverlay.module.css'

function useHoverDelay(delayMs = 150) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const show = useCallback(() => { clearTimeout(timer.current); setOpen(true) }, [])
  const hide = useCallback(() => { timer.current = setTimeout(() => setOpen(false), delayMs) }, [delayMs])
  return { open, show, hide }
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

interface ProcTooltipProps {
  hexes: string[]
  lastSeenMs: number | undefined
  onSelect: (hex: string) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function ProcTooltip({ hexes, lastSeenMs, onSelect, onMouseEnter, onMouseLeave }: ProcTooltipProps) {
  const aircraftMap = useAircraftStore((s) => s.aircraftMap)
  const remaining = formatRemaining(lastSeenMs)
  return (
    <div className={styles.tooltip} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {hexes.length > 0 ? (
        hexes.map((hex) => {
          const ac = aircraftMap.get(hex)
          const label = ac ? (ac.flight?.trim() || ac.registration || hex.toUpperCase()) : hex.toUpperCase()
          return (
            <button key={hex} className={styles.callsign} onClick={() => onSelect(hex)}>
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
  )
}

/** Per-airport sub-header (multi-airport mode): ident + ATIS letter badge with
 *  hover-to-reveal raw text. */
function GroupHeader({ label, atis }: { label: string; atis: AtisInfo | null | undefined }) {
  const hover = useHoverDelay()
  const hasAtis = atis && atis.code !== '?'
  return (
    <div className={styles.groupHeader}>
      <span className={styles.groupIdent}>{label}</span>
      {hasAtis && (
        <span
          className={styles.atisBadge}
          onMouseEnter={hover.show}
          onMouseLeave={hover.hide}
          style={{ position: 'relative' }}
        >
          ATIS {atis!.code}
          {hover.open && (
            <div
              className={styles.atisFullText}
              onMouseEnter={hover.show}
              onMouseLeave={hover.hide}
            >
              {atis!.raw}
            </div>
          )}
        </span>
      )}
    </div>
  )
}

export function ActiveProceduresOverlay() {
  const procedures = useProcedureStore((s) => s.procedures)
  const autoShownIds = useProcedureStore((s) => s.autoShownIds)
  const userToggles = useProcedureStore((s) => s.userToggles)
  const detectedHexes = useProcedureStore((s) => s.detectedHexes)
  const lastDetectedAt = useProcedureStore((s) => s.lastDetectedAt)
  const atisInfo = useAirportStore((s) => s.atisInfo)
  const activeAirports = useAirportStore((s) => s.activeAirports)
  const atisByIcao = useAirportStore((s) => s.atisByIcao)

  const selected = useSelectionStore((s) => s.selected)
  const selectAircraftSel = useSelectionStore((s) => s.select)
  const toggleSelection = useSelectionStore((s) => s.toggle)
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
  const keepProcTooltip = useCallback(() => clearTimeout(procHideTimer.current), [])

  const selectAircraft = useCallback((hex: string) => {
    const ac = useAircraftStore.getState().aircraftMap.get(hex)
    if (!ac) return
    selectAircraftSel({ kind: 'aircraft', hex })
    setViewport({ longitude: ac.interpLon, latitude: ac.interpLat, zoom: 13 })
  }, [selectAircraftSel, setViewport])

  const active = procedures.filter(
    (p) => autoShownIds.has(p.id) || userToggles[p.id] === true,
  )

  if (active.length === 0) return null

  const renderRow = (p: Procedure) => {
    const hexes = detectedHexes[p.id] ?? []
    const isAutoShown = autoShownIds.has(p.id)
    const isHovered = hoveredProcId === p.id
    const isApproach = p.type === 'APPROACH'
    const isSelected = selected?.kind === 'approach' && selected.procedureId === p.id
    return (
      <div
        key={p.id}
        className={styles.item}
        onMouseEnter={() => isAutoShown && showProcTooltip(p.id)}
        onMouseLeave={hideProcTooltip}
      >
        <span className={styles.dot} style={{ background: p.color }} />
        <span
          className={`${styles.name} ${isApproach ? styles.nameSelectable : ''} ${isSelected ? styles.nameSelected : ''}`}
          onClick={isApproach ? () => toggleSelection({ kind: 'approach', procedureId: p.id }) : undefined}
        >
          {p.name}
        </span>
        <span className={styles.badge}>{p.type}</span>
        {isHovered && isAutoShown && (
          <ProcTooltip
            hexes={hexes}
            lastSeenMs={lastDetectedAt[p.id]}
            onSelect={selectAircraft}
            onMouseEnter={keepProcTooltip}
            onMouseLeave={hideProcTooltip}
          />
        )}
      </div>
    )
  }

  const multi = activeAirports.length >= 2

  // ── Multi-airport mode: group rows by airport with a per-airport sub-header ──
  if (multi) {
    return (
      <div
        className={clsx(styles.overlay, activeAirports.length >= 3 && styles.scroll)}
        data-map-overlay=""
      >
        <div className={styles.title}>IN USE</div>
        {activeAirports.map((a) => {
          const key = airportKey(a)
          const group = active.filter((p) => p.icao.toUpperCase() === key)
          if (group.length === 0) return null
          return (
            <div key={key} className={styles.group}>
              <GroupHeader label={key} atis={atisByIcao[key]} />
              {group.map(renderRow)}
            </div>
          )
        })}
      </div>
    )
  }

  // ── Single-airport mode: exactly as before (primary ATIS + full summary) ──
  const hasAtis = atisInfo && atisInfo.code !== '?'
  const arrSummary = hasAtis ? arrivalSummary(atisInfo) : ''
  const depSummary = hasAtis && atisInfo.depRunways.length > 0
    ? atisInfo.depRunways.join(' ')
    : ''
  const depAdvisory = hasAtis && atisInfo.depRunwaysAdvisory.length > 0
    ? atisInfo.depRunwaysAdvisory.join(' ')
    : ''

  return (
    <div className={styles.overlay} data-map-overlay="">
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
      {hasAtis && (arrSummary || depSummary || depAdvisory) && (
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
          {(depSummary || depAdvisory) && (
            <div className={styles.atisSummaryRow}>
              <span className={styles.atisLabel}>DEP</span>
              {depSummary && <span className={styles.atisValue}>{depSummary}</span>}
              {depAdvisory && (
                <span className={styles.atisValueAdvisory} title="Plan and brief — not the primary departure runway">
                  ({depAdvisory})
                </span>
              )}
            </div>
          )}
          {atisHover.open && (
            <div
              className={styles.atisFullText}
              onMouseEnter={atisHover.show}
              onMouseLeave={atisHover.hide}
            >
              {atisInfo.raw}
            </div>
          )}
        </div>
      )}

      {/* ── Procedure list ─────────────────────────────────────────── */}
      {active.map(renderRow)}

    </div>
  )
}
