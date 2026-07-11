import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './NotForNavigation.module.css'

interface DataSource {
  name: string
  href: string
  detail: string
}

// Public upstream data sources (see CLAUDE.md "Data sources"). Links open the
// provider's homepage in a new tab.
const DATA_SOURCES: DataSource[] = [
  {
    name: 'ADS-B Exchange',
    href: 'https://www.adsbexchange.com/',
    detail: 'Live aircraft positions',
  },
  {
    name: 'adsb.lol',
    href: 'https://adsb.lol/',
    detail: 'Callsign → route lookups',
  },
  {
    name: 'adsbdb',
    href: 'https://www.adsbdb.com/',
    detail: 'Callsign → route fallback',
  },
  {
    name: 'FAA CIFP / Aeronautical Data',
    href: 'https://www.faa.gov/air_traffic/flight_info/aeronav/',
    detail: 'Procedures, waypoints, MVA/MIA sectors (ARINC 424, 28-day AIRAC cycle)',
  },
  {
    name: 'FAA Aeronautical Information Services',
    href: 'https://www.faa.gov/air_traffic/flight_info/aeronav/aeronautical_data/',
    detail: 'Class B/C/D/E airspace boundaries',
  },
  {
    name: 'atis.info',
    href: 'https://atis.info/',
    detail: 'Digital ATIS (runways & approaches in use)',
  },
  {
    name: 'OurAirports',
    href: 'https://ourairports.com/',
    detail: 'Airport metadata & runway geometry',
  },
  {
    name: 'Mapbox',
    href: 'https://www.mapbox.com/',
    detail: 'Base map & terrain rendering',
  },
]

// Known ways our depiction can differ from the official published sources,
// roughly in priority order (most likely to mislead first).
const KNOWN_DIFFERENCES: { heading: string; items: string[] }[] = [
  {
    heading: 'Traffic',
    items: [
      'Only aircraft broadcasting ADS-B appear — non-equipped, blocked, or non-transmitting traffic (including some military) is invisible.',
      'Positions are polled every few seconds and dead-reckoned between polls, so a target on screen is an estimate that lags reality by seconds.',
      'No separation, TCAS, conflict, or wake information of any kind is shown or implied.',
      'Callsign-to-route (origin → destination) is best-effort crowd-sourced data and is frequently missing or wrong.',
    ],
  },
  {
    heading: 'Procedures',
    items: [
      'Routes are drawn from the FAA CIFP coded (ARINC 424) data, not the published chart — geometry, labels, and fixes may differ from the plate.',
      'Maximum holding altitudes are not available in the CIFP, so holds show only the coded crossing constraint (e.g. "at or above"), not the charted maximum.',
      'Glidepath / descent angles are taken from path-point, ILS, or coded VDA data and are inferred where those are absent.',
      'Course reversals, procedure turns, and NoPT applicability are inferred from the coded legs and may not match the charted depiction.',
      'DME arcs are drawn as sampled constant-radius arcs — an approximation of the true ground track.',
      'Only Locator Outer Markers (an FAF collocated with an NDB) are inferred; other marker beacons are not shown because the CIFP contains no marker records.',
      'Missed-approach and lost-comms segments are only partially depicted.',
      'Coverage is limited to US airports with published instrument approaches.',
    ],
  },
  {
    heading: 'Airspace',
    items: [
      'Class B/C/D/E boundaries come from an FAA GIS dataset that can lag current charts and NOTAMs.',
      'Special-use airspace (MOAs, restricted, prohibited, warning areas), TFRs, and NOTAM-driven changes are not shown.',
      'Vertical (floor/ceiling) limits may be simplified or omitted; boundaries are primarily lateral.',
    ],
  },
  {
    heading: 'Terrain & obstacles',
    items: [
      'Terrain is a Mapbox visual rendering for context only — not survey-grade elevation.',
      'MVA/MIA sectors are shown only where FAA AIXM data is published for that facility.',
      'No obstacle data (towers, buildings) and no MSA/emergency-safe-altitude rings are depicted.',
    ],
  },
]

export function NotForNavigation() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    // Lock background scroll while the dialog is open.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        Not for Navigation
      </button>

      {open &&
        createPortal(
          <div
            className={styles.backdrop}
            onClick={() => setOpen(false)}
            role="presentation"
          >
            <div
              className={styles.dialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="nfn-title"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={styles.close}
                onClick={() => setOpen(false)}
                aria-label="Close disclaimer"
              >
                ×
              </button>

              <div className={styles.scroll}>
                <h2 id="nfn-title" className={styles.title}>
                  Not for Navigation
                </h2>

                <section className={styles.section}>
                  <p>
                    Approach Map is for <strong>informational use only</strong>. It
                    exists to help aviation enthusiasts visualize live air traffic
                    relative to published instrument procedures at their favorite
                    airports.
                  </p>
                  <p>
                    Data is aggregated from several public sources (listed below) and
                    may deviate from the official charts and publications. It can be
                    incomplete, delayed, or inaccurate.
                  </p>
                  <p>
                    <strong>
                      Always refer to official FAA publications for flight planning
                      and navigation.
                    </strong>{' '}
                    Never use this app operationally.
                  </p>
                </section>

                <section className={styles.section}>
                  <h3 className={styles.heading}>Known differences from official sources</h3>
                  {KNOWN_DIFFERENCES.map((group) => (
                    <div key={group.heading} className={styles.diffGroup}>
                      <h4 className={styles.subheading}>{group.heading}</h4>
                      <ul className={styles.list}>
                        {group.items.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>

                <section className={styles.section}>
                  <h3 className={styles.heading}>Data sources</h3>
                  <ul className={styles.sourceList}>
                    {DATA_SOURCES.map((src) => (
                      <li key={src.name}>
                        <a href={src.href} target="_blank" rel="noopener noreferrer">
                          {src.name}
                        </a>
                        <span className={styles.sourceDetail}> — {src.detail}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
