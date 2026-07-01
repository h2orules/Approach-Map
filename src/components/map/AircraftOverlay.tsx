import { useEffect, useMemo, useRef } from 'react'
import type { MapRef } from 'react-map-gl'
import { useAircraftStore } from '../../store/useAircraftStore'
import { formatAltitude, formatSpeed, formatHeading } from '../../utils/formatters'
import styles from './AircraftOverlay.module.css'

interface Props {
  mapRef: React.RefObject<MapRef | null>
}

function AircraftIcon() {
  return (
    <svg width={42} height={42} viewBox="0 0 24 24" className={styles.icon}>
      <path fill="#f59e0b" stroke="#0b0f14" strokeWidth={0.6} d="M12 2L8 18l4-2 4 2L12 2Z" />
      <path fill="#f59e0b" stroke="#0b0f14" strokeWidth={0.6} d="M5 12L2 14l10-2 10 2-3-2H5Z" />
    </svg>
  )
}

/**
 * Aircraft rendered as a DOM overlay (not a GL layer) so they sit above the
 * waypoint markers, stay crisp at any size, and update at 60fps. The marker
 * list re-renders only when the aircraft set changes (poll `revision`); per-
 * frame position updates are applied imperatively to avoid React churn.
 */
export function AircraftOverlay({ mapRef }: Props) {
  const revision = useAircraftStore((s) => s.revision)
  const selectedHex = useAircraftStore((s) => s.selectedHex)
  const setSelectedHex = useAircraftStore((s) => s.setSelectedHex)
  const nodes = useRef<Map<string, HTMLDivElement>>(new Map())

  // Snapshot the airborne aircraft set; only changes on a poll.
  const aircraft = useMemo(
    () => useAircraftStore.getState().getAll().filter((a) => a.altBaro !== 'ground'),
    [revision],
  )

  // Continuous reposition loop (also handles pan/zoom since it reprojects).
  useEffect(() => {
    let raf = 0
    const frame = () => {
      const map = mapRef.current?.getMap()
      if (map) {
        const store = useAircraftStore.getState()
        for (const [hex, node] of nodes.current) {
          const ac = store.aircraftMap.get(hex)
          if (!ac) continue
          const p = map.project([ac.interpLon, ac.interpLat])
          node.style.transform = `translate(${p.x}px, ${p.y}px)`
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [mapRef])

  // Deselect when clicking empty map (plane clicks are handled on the markers).
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    const onClick = () => setSelectedHex(null)
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [mapRef, setSelectedHex])

  return (
    <div className={styles.overlay}>
      {aircraft.map((ac) => {
        const label = (ac.flight && ac.flight.trim()) || ac.registration || ac.hex.toUpperCase()
        return (
          <div
            key={ac.hex}
            ref={(el) => {
              if (el) nodes.current.set(ac.hex, el)
              else nodes.current.delete(ac.hex)
            }}
            className={`${styles.ac} ${ac.hex === selectedHex ? styles.selected : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              setSelectedHex(ac.hex === selectedHex ? null : ac.hex)
            }}
          >
            <div className={styles.iconWrap} style={{ transform: `translate(-50%, -50%) rotate(${ac.track}deg)` }}>
              <AircraftIcon />
            </div>
            <div className={styles.tag}>{label}</div>
            <div className={styles.info}>
              {formatAltitude(ac.altBaro)}
              {ac.altBaro !== 'ground' && ac.baroRate > 100 ? '↑' : ac.altBaro !== 'ground' && ac.baroRate < -100 ? '↓' : ''}
              {' '}{formatSpeed(ac.groundspeed)}<br />
              {formatHeading(ac.track)}{ac.typeCode ? ` ${ac.typeCode}` : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}
