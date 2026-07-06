import { useEffect, useMemo, useRef } from 'react'
import type { MapRef } from 'react-map-gl'
import { useAircraftStore } from '../../store/useAircraftStore'
import { useSelectionStore, selectedHexOf } from '../../store/useSelectionStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { formatAltitude, formatSpeed, formatHeading } from '../../utils/formatters'
import { altitudeColor } from '../../utils/colorScheme'
import { positionToMinFt, positionToMaxFt } from '../../utils/altitudeFilter'
import { VFR_SQUAWK } from '../../config/constants'
import styles from './AircraftOverlay.module.css'

interface Props {
  mapRef: React.RefObject<MapRef | null>
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

  // Snapshot the airborne aircraft set; only changes on a poll.
  const aircraft = useMemo(
    () => useAircraftStore.getState().getAll().filter((a) => a.altBaro !== 'ground'),
    [revision],
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
        const minFt = positionToMinFt(altFilterMin)
        const maxFt = positionToMaxFt(altFilterMax)

        for (const [hex, node] of nodes.current) {
          const ac = store.aircraftMap.get(hex)
          if (!ac) continue

          const alt = ac.altBaro as number
          // Same imperative show/hide path as the altitude filter, so toggling
          // these takes effect immediately without a React re-render.
          const hidden =
            alt < minFt ||
            alt > maxFt ||
            (!showTisb && hex.startsWith('~')) ||
            (!showVfr && ac.squawk === VFR_SQUAWK)

          if (hidden) {
            node.style.display = 'none'
            continue
          }
          node.style.display = ''

          const p = map.project([ac.interpLon, ac.interpLat])
          node.style.transform = `translate(${p.x}px, ${p.y}px)`
          node.style.color = altitudeColor(ac.altBaro)
          // Higher altitude = higher z-index = rendered on top.
          node.style.zIndex = String(Math.max(1, Math.floor(alt / 100)))
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [mapRef])

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
              zIndex: ac.altBaro !== 'ground' ? Math.max(1, Math.floor((ac.altBaro as number) / 100)) : 1,
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

            <div className={styles.dataLabel}>
              {/* Line 1: callsign or tail number */}
              <div className={styles.line}>
                <span className={styles.callsign}>{label}</span>
              </div>
              {/* Line 2: ALT↑ SPD HDG° */}
              <div className={styles.line}>
                <span className={styles.altspd}>{altStr}{vsi} {formatSpeed(ac.groundspeed)}</span>
                {' '}
                <span className={styles.heading}>{formatHeading(ac.track)}</span>
              </div>
              {/* Line 3: VFR (squawk 1200) or ORIG→DEST, then TYPE, then a
                  TIS-B source tag for radar-rebroadcast (~hex) targets */}
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
            </div>
          </div>
        )
      })}
    </div>
  )
}
