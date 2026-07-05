import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MapRef } from 'react-map-gl'
import { useProfileProcedure } from '../../hooks/useProfileProcedure'
import { useSelectionStore, selectedHexOf } from '../../store/useSelectionStore'
import { useProcedureStore, computeVisibility } from '../../store/useProcedureStore'
import { useAircraftStore } from '../../store/useAircraftStore'
import { useCifpStore, getRunwayInfoForAirport } from '../../services/cifpCache'
import { pickProfileTransition, buildProfileModel, alongTrackNm } from '../../geo/profileMath'
import type { ProfileModel, LiveAircraft } from '../../geo/profileMath'
import { pickPanelAnchor, type Rect } from '../../geo/panelPlacement'
import {
  PROFILE_PANEL_MIN_W,
  PROFILE_PANEL_MIN_H,
  PROFILE_MARGIN_PX,
  PROFILE_AIRCRAFT_UPDATE_MS,
} from '../../config/constants'
import type { CifpRunwayInfo } from '../../types/cifp'
import { ProfileHeader } from './ProfileHeader'
import { ProfileSvg } from './ProfileSvg'
import styles from './ProfilePanel.module.css'

interface Props {
  mapRef: React.RefObject<MapRef | null>
}

interface PanelRect {
  x: number
  y: number
  width: number
  height: number
}

const DEFAULT_RECT: PanelRect = {
  x: PROFILE_MARGIN_PX,
  y: PROFILE_MARGIN_PX,
  width: PROFILE_PANEL_MIN_W,
  height: PROFILE_PANEL_MIN_H,
}

export function ProfilePanel({ mapRef }: Props) {
  const procedure = useProfileProcedure()
  const clearSelection = useSelectionStore((s) => s.clear)
  const selectedHex = useSelectionStore((s) => selectedHexOf(s.selected))

  const procedures = useProcedureStore((s) => s.procedures)
  const userToggles = useProcedureStore((s) => s.userToggles)
  const autoVisible = useProcedureStore((s) => s.autoVisible)
  const detectedHexesForProc = useProcedureStore((s) =>
    procedure ? s.detectedHexes[procedure.id] : undefined,
  )

  const cifpData = useCifpStore((s) => s.data)

  const [rect, setRect] = useState<PanelRect>(DEFAULT_RECT)
  const lastAutoProcId = useRef<string | null>(null)
  const dragStart = useRef<{ startClientX: number; startClientY: number; startX: number; startY: number } | null>(
    null,
  )

  const panelRef = useRef<HTMLDivElement>(null)
  const svgWrapRef = useRef<HTMLDivElement>(null)
  const [svgSize, setSvgSize] = useState({ width: PROFILE_PANEL_MIN_W - 20, height: PROFILE_PANEL_MIN_H - 130 })

  const transition = useMemo(() => (procedure ? pickProfileTransition(procedure) : null), [procedure])

  // cifpData is a dependency only to re-run this lookup once the CIFP
  // store finishes loading (getRunwayInfoForAirport itself is synchronous).
  const rwy = useMemo<CifpRunwayInfo | null>(() => {
    void cifpData
    if (!procedure) return null
    const info = getRunwayInfoForAirport(procedure.icao)
    const ident = procedure.runways[0]
    return ident ? info[`RW${ident}`] ?? null : null
  }, [procedure, cifpData])

  const model = useMemo<ProfileModel | null>(() => {
    if (!procedure || !transition) return null
    return buildProfileModel(procedure, transition, rwy)
  }, [procedure, transition, rwy])

  // Dev diagnostic: a FAF / glideslope-intercept fix with no parsed crossing
  // altitude is almost certainly a CIFP parse gap (the FAF altitude drives the
  // glideslope anchor), not a normally-unconstrained step-down fix. Surfacing
  // it here separates a real data problem from the interpolation fallback.
  useEffect(() => {
    if (!import.meta.env.DEV || !model || !procedure) return
    const missing = model.fixes.filter((f) => (f.role === 'faf' || f.isGsIntercept) && f.plotAltFt == null)
    if (missing.length > 0) {
      console.warn(
        `[profile] ${procedure.name} (${procedure.id}): FAF/GS-intercept fix(es) with no parsed crossing ` +
          `altitude: ${missing.map((f) => f.fixId).join(', ')} — likely a CIFP parse gap, not an unconstrained fix.`,
      )
    }
  }, [model, procedure])

  // ── Initial auto-placement: once per procedure id, unless the user dragged. ──
  useEffect(() => {
    if (!procedure) return
    // Already placed for this procedure (auto or user-dragged) — leave it be.
    if (lastAutoProcId.current === procedure.id) return

    const map = mapRef.current?.getMap()
    if (!map) return

    const containerRect = map.getContainer().getBoundingClientRect()
    const containerW = containerRect.width
    const containerH = containerRect.height

    const width = Math.min(720, Math.max(PROFILE_PANEL_MIN_W, containerW - 2 * PROFILE_MARGIN_PX))
    const height = Math.min(PROFILE_PANEL_MIN_H, Math.max(160, containerH - 2 * PROFILE_MARGIN_PX))

    const candidates: Rect[] = [
      { x: PROFILE_MARGIN_PX, y: PROFILE_MARGIN_PX, w: width, h: height },
      { x: containerW - PROFILE_MARGIN_PX - width, y: PROFILE_MARGIN_PX, w: width, h: height },
      { x: PROFILE_MARGIN_PX, y: containerH - PROFILE_MARGIN_PX - height, w: width, h: height },
      { x: containerW - PROFILE_MARGIN_PX - width, y: containerH - PROFILE_MARGIN_PX - height, w: width, h: height },
    ]

    const obstaclePts: Array<{ x: number; y: number }> = []
    for (const p of procedures) {
      if (!computeVisibility(userToggles, autoVisible, p.id)) continue
      for (const sym of p.symbols) {
        obstaclePts.push(map.project([sym.lon, sym.lat]))
      }
    }

    // Measure the other absolutely-positioned overlays sharing this container
    // (they mark themselves with data-map-overlay) so placement avoids their
    // real on-screen footprint rather than numbers copied from their CSS.
    const reservedRects: Rect[] = []
    const host = map.getContainer().parentElement
    if (host) {
      for (const el of Array.from(host.querySelectorAll<HTMLElement>('[data-map-overlay]'))) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) {
          reservedRects.push({
            x: r.left - containerRect.left,
            y: r.top - containerRect.top,
            w: r.width,
            h: r.height,
          })
        }
      }
    }

    const idx = pickPanelAnchor(candidates, obstaclePts, reservedRects)
    const chosen = candidates[idx]
    setRect({ x: chosen.x, y: chosen.y, width, height })
    lastAutoProcId.current = procedure.id
  }, [procedure, procedures, userToggles, autoVisible, mapRef])

  // ── Drag (pointer-capture pattern, see AltitudeFilter.tsx) ──
  const onTitlebarPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      dragStart.current = { startClientX: e.clientX, startClientY: e.clientY, startX: rect.x, startY: rect.y }
    },
    [rect.x, rect.y],
  )

  const onTitlebarPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStart.current) return
    const dx = e.clientX - dragStart.current.startClientX
    const dy = e.clientY - dragStart.current.startClientY
    setRect((prev) => ({ ...prev, x: dragStart.current!.startX + dx, y: dragStart.current!.startY + dy }))
  }, [])

  const onTitlebarPointerUp = useCallback(() => {
    dragStart.current = null
  }, [])

  // ── Measure the SVG content area so ProfileSvg gets real pixel dimensions. ──
  useLayoutEffect(() => {
    const el = svgWrapRef.current
    if (!el) return
    const measure = () => setSvgSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [rect.width, rect.height, model])

  // ── Live aircraft positions on the profile ──
  // Shows every plane the detection engine currently has confirmed+assigned to
  // this approach (`detectedHexes[procedure.id]`), not just a selected one — an
  // explicitly-selected approach shows all confirmed traffic with nothing
  // highlighted until/unless one of those planes is also the selection.
  const [liveAircraft, setLiveAircraft] = useState<LiveAircraft[]>([])
  useEffect(() => {
    if (!procedure || !transition || !detectedHexesForProc || detectedHexesForProc.length === 0) {
      setLiveAircraft([])
      return
    }

    const tick = () => {
      const aircraftMap = useAircraftStore.getState().aircraftMap
      const next: LiveAircraft[] = []
      for (const hex of detectedHexesForProc) {
        const ac = aircraftMap.get(hex)
        if (!ac || ac.altBaro === 'ground') continue
        const { distNm, xtNm } = alongTrackNm(transition, ac.interpLat, ac.interpLon)
        if (xtNm > 3) continue
        const label = (ac.flight && ac.flight.trim()) || ac.registration || ac.hex.toUpperCase()
        next.push({ hex, distNm, altFt: ac.altBaro, label, isSelected: hex === selectedHex })
      }
      setLiveAircraft(next)
    }

    tick()
    const id = setInterval(tick, PROFILE_AIRCRAFT_UPDATE_MS)
    return () => clearInterval(id)
  }, [procedure, transition, detectedHexesForProc, selectedHex])

  if (!procedure) return null

  return (
    <div
      ref={panelRef}
      className={styles.panel}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      <div
        className={styles.titlebar}
        onPointerDown={onTitlebarPointerDown}
        onPointerMove={onTitlebarPointerMove}
        onPointerUp={onTitlebarPointerUp}
        onPointerCancel={onTitlebarPointerUp}
      >
        <span className={styles.titlebarLabel}>Vertical Profile</span>
        <button className={styles.closeBtn} onClick={() => clearSelection()} aria-label="Close profile panel">
          ✕
        </button>
      </div>

      <div className={styles.content}>
        {model ? (
          <>
            <ProfileHeader procedure={procedure} model={model} />
            <div ref={svgWrapRef} className={styles.svgWrap}>
              <ProfileSvg
                model={model}
                liveAircraft={liveAircraft}
                width={Math.max(svgSize.width, 1)}
                height={Math.max(svgSize.height, 1)}
              />
            </div>
          </>
        ) : (
          <div className={styles.noGeometry}>No procedure geometry available for this approach.</div>
        )}
      </div>
    </div>
  )
}
