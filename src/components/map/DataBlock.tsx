import { useState } from 'react'
import { Popup } from 'react-map-gl'
import type { InterpolatedAircraft } from '../../types/aircraft'
import {
  formatAltitude,
  formatSpeed,
  formatVerticalRate,
  formatCallsign,
  formatHeading,
  formatSquawk,
} from '../../utils/formatters'
import styles from './DataBlock.module.css'

interface Props {
  aircraft: InterpolatedAircraft
  onClose: () => void
}

export function DataBlock({ aircraft, onClose }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Popup
      longitude={aircraft.interpLon}
      latitude={aircraft.interpLat}
      anchor="bottom-left"
      onClose={onClose}
      closeButton={false}
      closeOnClick={false}
      className={styles.popup}
      offset={[8, -8] as [number, number]}
    >
      <div className={styles.block} onClick={() => setExpanded((e) => !e)}>
        <div className={styles.callsign}>{formatCallsign(aircraft.flight)}</div>
        <div className={styles.row}>
          <span className={styles.alt}>{formatAltitude(aircraft.altBaro)}</span>
          <span className={styles.speed}>{formatSpeed(aircraft.groundspeed)}</span>
          <span className={styles.type}>{aircraft.typeCode || '???'}</span>
        </div>

        {expanded && (
          <div className={styles.expanded}>
            <div className={styles.expandRow}>
              <span className={styles.label}>REG</span>
              <span>{aircraft.registration || '---'}</span>
            </div>
            <div className={styles.expandRow}>
              <span className={styles.label}>SQK</span>
              <span>{formatSquawk(aircraft.squawk)}</span>
            </div>
            <div className={styles.expandRow}>
              <span className={styles.label}>HDG</span>
              <span>{formatHeading(aircraft.track)}</span>
            </div>
            <div className={styles.expandRow}>
              <span className={styles.label}>V/S</span>
              <span className={aircraft.baroRate > 200 ? styles.climbing : aircraft.baroRate < -200 ? styles.descending : ''}>
                {formatVerticalRate(aircraft.baroRate)}
              </span>
            </div>
            {aircraft.origin && (
              <div className={styles.expandRow}>
                <span className={styles.label}>FROM</span>
                <span>{aircraft.origin}</span>
              </div>
            )}
            {aircraft.destination && (
              <div className={styles.expandRow}>
                <span className={styles.label}>TO</span>
                <span>{aircraft.destination}</span>
              </div>
            )}
          </div>
        )}
        <div className={styles.expandHint}>{expanded ? '▲ less' : '▼ more'}</div>
      </div>
    </Popup>
  )
}
