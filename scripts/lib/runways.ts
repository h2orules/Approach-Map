import type { Runway } from '../../src/types/airport'

/**
 * Runway geometry derivation from OurAirports `runways.csv` rows. Extracted
 * verbatim from scripts/buildStaticData.ts so both buildStaticData.ts (curated
 * runways.json) and buildAirportIndex.ts (per-airport shards) produce runway
 * objects in exactly the same shape and field order.
 */

export type OaRow = Record<string, string>

/**
 * Build one `Runway` from an OurAirports runway row, or `null` when the row is
 * closed or is missing usable threshold coordinates. Field order matches the
 * runways.json shape exactly (id, lengthFt, widthFt, surfaceCode, lowEnd,
 * highEnd) so JSON output is byte-stable.
 */
export function buildRunway(rw: OaRow): Runway | null {
  if (rw.closed === '1') return null

  const leLat = parseFloat(rw.le_latitude_deg)
  const leLon = parseFloat(rw.le_longitude_deg)
  const heLat = parseFloat(rw.he_latitude_deg)
  const heLon = parseFloat(rw.he_longitude_deg)
  if (isNaN(leLat) || isNaN(leLon) || isNaN(heLat) || isNaN(heLon)) return null

  const lengthFt = parseInt(rw.length_ft) || 0
  const widthFt = parseInt(rw.width_ft) || 150

  return {
    id: `${rw.le_ident}/${rw.he_ident}`,
    lengthFt,
    widthFt,
    surfaceCode: (rw.surface || '').toUpperCase().slice(0, 3),
    lowEnd: {
      id: rw.le_ident,
      heading: parseFloat(rw.le_heading_degT) || 0,
      lat: leLat,
      lon: leLon,
      displacedThresholdFt: parseFloat(rw.le_displaced_threshold_ft) || 0,
    },
    highEnd: {
      id: rw.he_ident,
      heading: parseFloat(rw.he_heading_degT) || 0,
      lat: heLat,
      lon: heLon,
      displacedThresholdFt: parseFloat(rw.he_displaced_threshold_ft) || 0,
    },
  }
}

/**
 * Group OurAirports runway rows into `Runway[]` keyed by `airport_ident`.
 * When `wanted` is supplied, only those airport idents are retained (used by
 * buildStaticData.ts for the curated list); omit it to keep every airport
 * (used by buildAirportIndex.ts).
 */
export function deriveRunwaysByAirport(rows: OaRow[], wanted?: Set<string>): Record<string, Runway[]> {
  const byAirport: Record<string, Runway[]> = {}
  for (const rw of rows) {
    const ident = rw.airport_ident
    if (!ident) continue
    if (wanted && !wanted.has(ident)) continue
    const runway = buildRunway(rw)
    if (!runway) continue
    if (!byAirport[ident]) byAirport[ident] = []
    byAirport[ident].push(runway)
  }
  return byAirport
}
