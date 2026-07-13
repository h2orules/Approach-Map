import { useRef, useState } from 'react'
import { Popup } from 'react-map-gl'
import * as turf from '@turf/turf'
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
import { usePathStore } from '../../store/usePathStore'
import type { AircraftAlert } from '../../types/path'
import { VFR_SQUAWK } from '../../config/constants'
import { bearingDelta } from '../../geo/lineMatching'
import { getRecent } from '../../services/trackLog'
import styles from './DataBlock.module.css'

interface Props {
  aircraft: InterpolatedAircraft
  onClose: () => void
}

/** One of the four diagonal placements around the selected aircraft, named by
 * its bearing from the plane. Diagonals only — never due N/S — so the block
 * can never sit over the range-ring "N NM" badges (`RangeRingsLayer`/
 * `rangeRings.ts`, which anchor at bearing 0/180). */
export type BlockQuadrant = 45 | 135 | 225 | 315

const QUADRANTS: readonly BlockQuadrant[] = [45, 135, 225, 315]

// Hysteresis thresholds (see pickBlockQuadrant): the current quadrant is only
// abandoned when it's gotten genuinely bad (score below this) AND a candidate
// is clearly better (margin at or above this) — otherwise minor track jitter
// would flap the block between quadrants every poll.
const HYSTERESIS_MIN_SCORE_DEG = 30
const HYSTERESIS_SWITCH_MARGIN_DEG = 20

/**
 * Pick the diagonal quadrant (bearing from the aircraft) that best clears both
 * the projected path ahead (`projectionDeg`, typically `aircraft.track`) and
 * the recent flown trail behind (`trailDeg`). Each candidate is scored by its
 * angular distance to the *nearer* of the two directions to avoid; the
 * candidate farthest from its nearest obstacle wins.
 *
 * `currentQuadrant` (null when there isn't one yet, e.g. a fresh selection)
 * enables hysteresis: the incumbent is kept unless its own score has dropped
 * below `HYSTERESIS_MIN_SCORE_DEG` *and* the best candidate beats it by at
 * least `HYSTERESIS_SWITCH_MARGIN_DEG`. Ties among candidates resolve to the
 * first in `QUADRANTS` (45 → 135 → 225 → 315).
 */
export function pickBlockQuadrant(
  projectionDeg: number,
  trailDeg: number,
  currentQuadrant: BlockQuadrant | null,
): BlockQuadrant {
  let bestQuadrant: BlockQuadrant = QUADRANTS[0]
  let bestScore = -Infinity
  for (const q of QUADRANTS) {
    const score = Math.min(bearingDelta(q, projectionDeg), bearingDelta(q, trailDeg))
    if (score > bestScore) {
      bestScore = score
      bestQuadrant = q
    }
  }

  if (currentQuadrant === null) return bestQuadrant

  const currentScore = Math.min(
    bearingDelta(currentQuadrant, projectionDeg),
    bearingDelta(currentQuadrant, trailDeg),
  )
  const shouldSwitch =
    currentScore < HYSTERESIS_MIN_SCORE_DEG && bestScore - currentScore >= HYSTERESIS_SWITCH_MARGIN_DEG
  return shouldSwitch ? bestQuadrant : currentQuadrant
}

/** react-map-gl Popup anchor + pixel offset for each quadrant — the anchor is
 * the corner of the block nearest the plane, and the offset (signed per axis)
 * pushes the block further into that quadrant. The horizontal push (44px) must
 * clear the range-ring "N NM" badges and a due-N/S projection line, both of
 * which occupy the vertical column through the aircraft (badges are ~48px wide,
 * centered); the vertical push (22px) likewise clears a due-E/W projection
 * line. Diagonal quadrant choice guarantees ≥~43° of angular clearance from
 * the projection/trail, so these fixed pushes keep the block off both. */
const QUADRANT_POPUP_PROPS: Record<
  BlockQuadrant,
  { anchor: 'bottom-left' | 'top-left' | 'top-right' | 'bottom-right'; offset: [number, number] }
> = {
  45: { anchor: 'bottom-left', offset: [44, -22] },
  135: { anchor: 'top-left', offset: [44, 22] },
  225: { anchor: 'top-right', offset: [-44, 22] },
  315: { anchor: 'bottom-right', offset: [-44, -22] },
}

/** Chip text + severity for one alert. Amber tiers ('alert', 'ta') render
 * dark-on-amber; red tiers ('warning', 'ra') render white-on-red and add the
 * blinking bar. Duplicated from AircraftOverlay.tsx (small, per-component
 * per project convention). */
function alertChipInfo(alert: AircraftAlert): { text: string; isRed: boolean } {
  const isRed = alert.tier === 'warning' || alert.tier === 'ra'
  if (alert.tier === 'ra') return { text: alert.raSense === 'climb' ? 'RA ↑' : 'RA ↓', isRed }
  if (alert.tier === 'ta') return { text: 'TA', isRed }
  return { text: alert.kind === 'terrain' ? 'TERRAIN' : 'TRAFFIC', isRed }
}

export function DataBlock({ aircraft, onClose }: Props) {
  const [logoOk, setLogoOk] = useState(true)
  const decoded = decodeCallsign(aircraft.flight)
  const quadrantRef = useRef<{ hex: string; quadrant: BlockQuadrant } | null>(null)
  // Alerts are filled per-poll by a separate engine (usePathStore); subscribe
  // to pathRevision (not the alerts Map itself) so this popup re-renders once
  // per poll when an alert appears/clears/changes tier.
  const pathRevision = usePathStore((s) => s.pathRevision)
  void pathRevision
  const alert = usePathStore.getState().alerts.get(aircraft.hex)
  const chip = alert ? alertChipInfo(alert) : null

  const originAirport = aircraft.origin ? getAirportByIcao(aircraft.origin) : undefined
  const destAirport = aircraft.destination ? getAirportByIcao(aircraft.destination) : undefined
  const friendlyType = decodeAircraftType(aircraft.typeCode)
  const isVfr = aircraft.squawk === VFR_SQUAWK
  const isTisb = aircraft.hex.startsWith('~')

  // Direction of the recent flown trail, as seen looking back from the
  // aircraft's current position (i.e. where the trail dots actually sit) —
  // this is the reciprocal of travel between an older recent point and the
  // newest one, which is why the <2-point fallback below is the reciprocal of
  // `track` rather than `track` itself (keeps the two cases continuous).
  const recent = getRecent(aircraft.hex, 3)
  let trailDeg: number
  if (recent.length >= 2) {
    const older = recent[0]
    const newest = recent[recent.length - 1]
    trailDeg =
      (turf.bearing(turf.point([newest.lon, newest.lat]), turf.point([older.lon, older.lat])) + 360) % 360
  } else {
    trailDeg = (aircraft.track + 180) % 360
  }

  const prevChoice = quadrantRef.current
  const currentQuadrant = prevChoice && prevChoice.hex === aircraft.hex ? prevChoice.quadrant : null
  const quadrant = pickBlockQuadrant(aircraft.track, trailDeg, currentQuadrant)
  quadrantRef.current = { hex: aircraft.hex, quadrant }
  const { anchor, offset } = QUADRANT_POPUP_PROPS[quadrant]

  return (
    <Popup
      longitude={aircraft.interpLon}
      latitude={aircraft.interpLat}
      anchor={anchor}
      onClose={onClose}
      closeButton={false}
      closeOnClick={false}
      className={styles.popup}
      offset={offset}
    >
      {(() => {
        const blockBody = (
          <>
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
          </>
        )

        if (!alert || !chip) {
          return <div className={styles.block}>{blockBody}</div>
        }

        return (
          <div className={styles.alertWrap}>
            <div className={`${styles.block} ${styles.alertBox}`}>{blockBody}</div>
            <div className={`${styles.chip} ${chip.isRed ? styles.warnChip : styles.alertChip}`}>
              {chip.text}
            </div>
            {chip.isRed && <div className={`${styles.warnBar} ${styles.blink}`} />}
          </div>
        )
      })()}
    </Popup>
  )
}
