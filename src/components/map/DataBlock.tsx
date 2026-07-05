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
import { decodeCallsign, airlineLogoUrl } from '../../utils/airlines'
import { decodeAircraftType } from '../../utils/aircraftTypes'
import { getAirportByIcao } from '../../hooks/useAirportSearch'
import { VFR_SQUAWK } from '../../config/constants'
import styles from './DataBlock.module.css'

interface Props {
  aircraft: InterpolatedAircraft
  onClose: () => void
}

export function DataBlock({ aircraft, onClose }: Props) {
  const [logoOk, setLogoOk] = useState(true)
  const decoded = decodeCallsign(aircraft.flight)

  const originAirport = aircraft.origin ? getAirportByIcao(aircraft.origin) : undefined
  const destAirport = aircraft.destination ? getAirportByIcao(aircraft.destination) : undefined
  const friendlyType = decodeAircraftType(aircraft.typeCode)
  const isVfr = aircraft.squawk === VFR_SQUAWK
  const isTisb = aircraft.hex.startsWith('~')

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
      <div className={styles.block}>
        <div className={styles.callsignRow}>
          <span className={styles.callsign}>{formatCallsign(aircraft.flight)}</span>
          {isTisb && <span className={styles.tisbBadge}>TIS-B</span>}
        </div>
        <div className={styles.row}>
          <span className={styles.alt}>{formatAltitude(aircraft.altBaro)}</span>
          <span className={styles.speed}>{formatSpeed(aircraft.groundspeed)}</span>
          <span className={styles.type}>{aircraft.typeCode || '???'}</span>
        </div>

        {isVfr ? (
          <div className={styles.route}>
            <span className={styles.vfr}>VFR</span>
          </div>
        ) : (
          (aircraft.origin || aircraft.destination) && (
            <div className={styles.route}>
              {aircraft.origin && (
                <>
                  <span className={styles.routeLabel}>FROM</span>
                  <span className={styles.routeCode}>{aircraft.origin}</span>
                </>
              )}
              {aircraft.destination && (
                <>
                  <span className={styles.routeLabel}>TO</span>
                  <span className={styles.routeCode}>{aircraft.destination}</span>
                </>
              )}
            </div>
          )
        )}

        <div className={styles.expanded}>
          {decoded.airline && (
              <div className={styles.airline}>
                {logoOk && (
                  <img
                    className={styles.airlineLogo}
                    src={airlineLogoUrl(decoded.airline.iata)}
                    alt={decoded.airline.name}
                    onError={() => setLogoOk(false)}
                  />
                )}
                <div>
                  <div className={styles.airlineName}>{decoded.airline.name}</div>
                  {decoded.flightNumber && (
                    <div className={styles.flightNo}>Flight {decoded.flightNumber}</div>
                  )}
                </div>
              </div>
            )}
            <div className={styles.expandRow}>
              <span className={styles.label}>TYPE</span>
              <span>{friendlyType || aircraft.typeCode || '---'}</span>
            </div>
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
                <span>
                  {aircraft.origin}
                  {originAirport ? ` · ${originAirport.name}` : ''}
                </span>
              </div>
            )}
            {aircraft.destination && (
              <div className={styles.expandRow}>
                <span className={styles.label}>TO</span>
                <span>
                  {aircraft.destination}
                  {destAirport ? ` · ${destAirport.name}` : ''}
                </span>
              </div>
            )}
        </div>
      </div>
    </Popup>
  )
}
