import { useEffect, useMemo, useRef } from 'react'
import type { MapRef } from 'react-map-gl'
import { useAircraftStore } from '../../store/useAircraftStore'
import { useSelectionStore, selectedHexOf } from '../../store/useSelectionStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { usePathStore } from '../../store/usePathStore'
import type { AircraftAlert } from '../../types/path'
import { formatAltitude, formatSpeed, formatHeading } from '../../utils/formatters'
import { altitudeColor } from '../../utils/colorScheme'
import { positionToMinFt, positionToMaxFt } from '../../utils/altitudeFilter'
import { VFR_SQUAWK } from '../../config/constants'
import styles from './AircraftOverlay.module.css'

interface Props {
  mapRef: React.RefObject<MapRef | null>
}

/** Added to the altitude-derived z-index for any aircraft carrying an alert,
 * so every alerted aircraft renders above all non-alerted traffic regardless
 * of altitude, while still ranking by altitude among themselves. */
const ALERT_Z_BASE = 100000

/** Screen-space threshold (px) below which a conflicting pair's labels are
 * pushed apart so both stay readable. */
const PAIR_LABEL_SEP_TRIGGER_PX = 140

/** How far (px) a label is displaced away from the other aircraft in a pair. */
const PAIR_LABEL_SEP_PX = 46

/** Per-frame lerp factor easing the label displacement toward its target so
 * it doesn't snap when an alert appears/clears. */
const PAIR_LABEL_SEP_EASE = 0.25

/** Chip text + severity for one alert. Amber tiers ('alert', 'ta') render
 * dark-on-amber; red tiers ('warning', 'ra') render white-on-red and add the
 * blinking bar. */
function alertChipInfo(alert: AircraftAlert): { text: string; isRed: boolean } {
  const isRed = alert.tier === 'warning' || alert.tier === 'ra'
  if (alert.tier === 'ra') return { text: alert.raSense === 'climb' ? 'RA ↑' : 'RA ↓', isRed }
  if (alert.tier === 'ta') return { text: 'TA', isRed }
  return { text: alert.kind === 'terrain' ? 'TERRAIN' : 'TRAFFIC', isRed }
}

function AircraftIcon() {
  return (
    <svg width={42} height={42} viewBox="0 0 24 24" className={styles.icon}>
      <path fill="currentColor" stroke="#0b0f14" strokeWidth={0.6} d="M12 2L8 18l4-2 4 2L12 2Z" />
    </svg>
  )
}

/**
 * Aircraft rendered as a DOM overlay (not a GL layer) so they sit above the
 * waypoint markers, stay crisp at any size, and update at 60fps. The marker
 * list re-renders only when the aircraft set changes (poll `revision`); per-
 * frame position, colour, z-index, and filter visibility updates are applied
 * imperatively to avoid React churn.
 */
export function AircraftOverlay({ mapRef }: Props) {
  const revision = useAircraftStore((s) => s.revision)
  const selectedHex = useSelectionStore((s) => selectedHexOf(s.selected))
  const toggleSelection = useSelectionStore((s) => s.toggle)
  const nodes = useRef<Map<string, HTMLDivElement>>(new Map())
  // The label element (dataLabelWrap when alerted, plain dataLabel otherwise)
  // for each aircraft, so the rAF loop can compose an extra pair-separation
  // translate onto it without touching the icon/container node.
  const labelNodes = useRef<Map<string, HTMLDivElement>>(new Map())
  // Current eased label-separation offset per hex, in screen px. Only hexes
  // that are (or were recently) displaced have an entry; settled hexes are
  // removed so the steady-state per-frame cost is a `.has()` check.
  const labelOffsets = useRef<Map<string, { x: number; y: number }>>(new Map())
  // Alerts are filled per-poll by a separate engine (usePathStore); subscribing
  // to pathRevision (not the alerts Map itself) buys one cheap re-render per
  // poll — same cadence as the aircraft-set revision below — without the rAF
  // loop ever touching this store.
  const pathRevision = usePathStore((s) => s.pathRevision)

  // Snapshot the airborne aircraft set; only changes on a poll.
  const aircraft = useMemo(
    () => useAircraftStore.getState().getAll().filter((a) => a.altBaro !== 'ground'),
    [revision, pathRevision],
  )

  // Continuous reposition loop — also updates colour, z-index, and filter
  // visibility so dragging the slider has immediate visual effect without
  // triggering React re-renders.
  useEffect(() => {
    let raf = 0
    const frame = () => {
      const map = mapRef.current?.getMap()
      if (map) {
        const store = useAircraftStore.getState()
        const { altFilterMin, altFilterMax, showTisb, showVfr } = useSettingsStore.getState()
        const { alerts, forcedVisibleHexes } = usePathStore.getState()
        const minFt = positionToMinFt(altFilterMin)
        const maxFt = positionToMaxFt(altFilterMax)

        for (const [hex, node] of nodes.current) {
          const ac = store.aircraftMap.get(hex)
          if (!ac) continue

          const alt = ac.altBaro as number
          // Same imperative show/hide path as the altitude filter, so toggling
          // these takes effect immediately without a React re-render. A hex
          // in forcedVisibleHexes (TA/RA participant) always renders through
          // these filters.
          const hidden =
            !forcedVisibleHexes.has(hex) &&
            (alt < minFt ||
              alt > maxFt ||
              (!showTisb && hex.startsWith('~')) ||
              (!showVfr && ac.squawk === VFR_SQUAWK))

          if (hidden) {
            node.style.display = 'none'
            continue
          }
          node.style.display = ''

          const p = map.project([ac.interpLon, ac.interpLat])
          node.style.transform = `translate(${p.x}px, ${p.y}px)`
          node.style.color = altitudeColor(ac.altBaro)

          const alert = alerts.get(hex)
          const baseZ = Math.max(1, Math.floor(alt / 100))
          // Alerted aircraft float above all non-alerted traffic, still
          // ranked by altitude among themselves.
          node.style.zIndex = String(alert ? ALERT_Z_BASE + baseZ : baseZ)

          // Pair-label separation: when this aircraft's alert names a
          // conflicting other aircraft that's currently close on screen,
          // displace the label away from it so both stay readable. Skipped
          // entirely for hexes with no alert and no in-flight easing, so
          // steady-state cost for the vast majority of (non-alerted)
          // aircraft is a single Map.has() check.
          const otherHex = alert?.otherHex
          const hasPriorOffset = labelOffsets.current.has(hex)
          const labelNode = labelNodes.current.get(hex)
          if (labelNode && (otherHex || hasPriorOffset)) {
            let targetX = 0
            let targetY = 0
            const other = otherHex ? store.aircraftMap.get(otherHex) : undefined
            if (other) {
              const op = map.project([other.interpLon, other.interpLat])
              let dx = p.x - op.x
              let dy = p.y - op.y
              const dist = Math.hypot(dx, dy)
              if (dist < PAIR_LABEL_SEP_TRIGGER_PX) {
                if (dist < 1e-6) {
                  // Coincident aircraft: split deterministically along +/-x
                  // rather than dividing by a near-zero distance.
                  dx = hex < otherHex! ? 1 : -1
                  dy = 0
                } else {
                  dx /= dist
                  dy /= dist
                }
                targetX = dx * PAIR_LABEL_SEP_PX
                targetY = dy * PAIR_LABEL_SEP_PX
              }
            }

            const prev = labelOffsets.current.get(hex) ?? { x: 0, y: 0 }
            const nextX = prev.x + (targetX - prev.x) * PAIR_LABEL_SEP_EASE
            const nextY = prev.y + (targetY - prev.y) * PAIR_LABEL_SEP_EASE

            if (targetX === 0 && targetY === 0 && Math.abs(nextX) < 0.05 && Math.abs(nextY) < 0.05) {
              // Fully eased back to rest: drop the entry and the inline
              // override so the label falls back to its plain CSS transform.
              labelOffsets.current.delete(hex)
              labelNode.style.transform = ''
            } else {
              labelOffsets.current.set(hex, { x: nextX, y: nextY })
              // Compose with the label's own base transform (translate(-50%,
              // 22px) below the icon) rather than replacing it — an inline
              // style always wins over the stylesheet rule, so the base
              // offset must be repeated here.
              labelNode.style.transform = `translate(-50%, 22px) translate(${nextX}px, ${nextY}px)`
            }
          }
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [mapRef])

  // Read once per render (only re-runs on the poll cadence above, never in the
  // per-frame rAF loop).
  const alerts = usePathStore.getState().alerts

  return (
    <div className={styles.overlay}>
      {aircraft.map((ac) => {
        const label = (ac.flight && ac.flight.trim()) || ac.registration || ac.hex.toUpperCase()
        const altStr = formatAltitude(ac.altBaro)
        const vsi =
          ac.altBaro !== 'ground' && ac.baroRate > 100
            ? '↑'
            : ac.altBaro !== 'ground' && ac.baroRate < -100
              ? '↓'
              : ''
        const hasRoute = !!(ac.origin || ac.destination)
        const origin = ac.origin || 'Unkwn'
        const dest = ac.destination || 'Unkwn'
        const isVfr = ac.squawk === VFR_SQUAWK
        const isTisb = ac.hex.startsWith('~')
        const alert = alerts.get(ac.hex)
        const chip = alert ? alertChipInfo(alert) : null

        // Line 1: callsign or tail number — kept separate from the data rows
        // below so an alert's border box can wrap only the latter (see the
        // alerted branch further down); rendered identically either way.
        const callsignRow = (
          <div className={styles.line}>
            <span className={styles.callsign}>{label}</span>
          </div>
        )

        // Lines 2-3: ALT↑ SPD HDG°, then VFR/ORIG→DEST + TYPE + TIS-B.
        const dataRows = (
          <>
            <div className={styles.line}>
              <span className={styles.altspd}>{altStr}{vsi} {formatSpeed(ac.groundspeed)}</span>
              {' '}
              <span className={styles.heading}>{formatHeading(ac.track)}</span>
            </div>
            {(isVfr || hasRoute || ac.typeCode || isTisb) && (
              <div className={`${styles.line} ${styles.lineTight}`}>
                {isVfr ? (
                  <span className={styles.vfr}>VFR</span>
                ) : (
                  hasRoute && (
                    <span className={styles.route}>{origin}→{dest}</span>
                  )
                )}
                {ac.typeCode && (
                  <span className={styles.type}>{isVfr || hasRoute ? ' ' : ''}{ac.typeCode}</span>
                )}
                {isTisb && (
                  <span className={styles.tisb}>{isVfr || hasRoute || ac.typeCode ? ' ' : ''}TIS-B</span>
                )}
              </div>
            )}
          </>
        )

        const dataLabelContent = (
          <>
            {callsignRow}
            {dataRows}
          </>
        )

        return (
          <div
            key={ac.hex}
            ref={(el) => {
              if (el) nodes.current.set(ac.hex, el)
              else nodes.current.delete(ac.hex)
            }}
            className={`${styles.ac} ${ac.hex === selectedHex ? styles.selected : ''}`}
            style={{
              color: altitudeColor(ac.altBaro),
              // Mirrors the rAF loop's z-index rule for the first paint before
              // the loop's first tick: alerted aircraft float above all
              // non-alerted traffic, ranked by altitude among themselves.
              zIndex:
                ac.altBaro !== 'ground'
                  ? (alert ? ALERT_Z_BASE : 0) + Math.max(1, Math.floor((ac.altBaro as number) / 100))
                  : 1,
            }}
            onClick={(e) => {
              e.stopPropagation()
              toggleSelection({ kind: 'aircraft', hex: ac.hex })
            }}
          >
            <div
              className={styles.iconWrap}
              style={{ transform: `translate(-50%, -50%) rotate(${ac.track}deg)` }}
            >
              <AircraftIcon />
            </div>

            {alert && chip ? (
              <div
                className={styles.dataLabelWrap}
                ref={(el) => {
                  if (el) labelNodes.current.set(ac.hex, el)
                  else {
                    labelNodes.current.delete(ac.hex)
                    labelOffsets.current.delete(ac.hex)
                  }
                }}
              >
                {callsignRow}
                <div className={`${styles.alertBox} ${chip.isRed ? styles.warnBox : ''}`}>
                  <div className={styles.dataLabel}>{dataRows}</div>
                </div>
                <div className={`${styles.chip} ${chip.isRed ? styles.warnChip : styles.alertChip}`}>
                  {chip.text}
                </div>
                {chip.isRed && <div className={`${styles.warnBar} ${styles.blink}`} />}
              </div>
            ) : (
              <div
                className={styles.dataLabel}
                ref={(el) => {
                  if (el) labelNodes.current.set(ac.hex, el)
                  else {
                    labelNodes.current.delete(ac.hex)
                    labelOffsets.current.delete(ac.hex)
                  }
                }}
              >
                {dataLabelContent}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
