import type { CifpAirportData } from '../../src/types/cifp'
import type { Procedure } from '../../src/types/procedure'
import type { OaRow } from './runways'

/**
 * Pure, unit-testable joins between the CIFP parse output (keyed by the ARINC
 * airport identifier — an ICAO like "KSEA"/"PANC" or a bare FAA LID like "A09")
 * and OurAirports metadata. No I/O, no globals — buildAirportIndex.ts wires the
 * downloads and file writes around these.
 */

/** One row of public/data/airport-index.json (the search corpus). */
export interface AirportIndexRow {
  key: string
  icao?: string
  name: string
  city: string
  state: string
  lat: number
  lon: number
  elev: number
  /** SID count. */
  s: number
  /** STAR count. */
  t: number
  /** Approach count (rows are only emitted when a > 0). */
  a: number
}

/** Airport metadata resolved for a CIFP key, from OurAirports or a CIFP fallback. */
export interface AirportMeta {
  name: string
  city: string
  state: string
  lat: number
  lon: number
  elev: number
  /** True when metadata came from an OurAirports row; false for the CIFP-centroid fallback. */
  matched: boolean
}

/**
 * Build a lookup from every usable identifier column in OurAirports to its row:
 * `ident`, `gps_code`, and `local_code`. Registering all three is what lets a
 * CIFP key resolve whether it is a full ICAO ("KSEA" via `ident`), a K-less
 * ident, or a 3-char FAA LID ("A09" via `ident`/`local_code`). Never assumes a
 * key length or a "K" prefix. First registration wins on collision (OurAirports
 * lists the authoritative row for an ident before reusing the code elsewhere).
 */
export function buildLookup(rows: OaRow[]): Map<string, OaRow> {
  const lookup = new Map<string, OaRow>()
  const reg = (raw: string | undefined, row: OaRow) => {
    if (!raw) return
    const key = raw.trim().toUpperCase()
    if (!key) return
    if (!lookup.has(key)) lookup.set(key, row)
  }
  for (const row of rows) {
    reg(row.ident, row)
    reg(row.gps_code, row)
    reg(row.local_code, row)
  }
  return lookup
}

/**
 * Resolve a CIFP airport key to its OurAirports row. Tries the key directly
 * (covers ICAO via `ident` and LIDs via `ident`/`local_code`), then a couple of
 * defensive fallbacks for the mismatch cases: a 4-char "K…" key whose OA row is
 * stored under the 3-char code, and a 3-char key whose OA row is under the
 * K-prefixed ICAO. These are attempts, not assumptions — the direct lookup is
 * authoritative and handles the overwhelming majority.
 */
export function resolveOaRow(lookup: Map<string, OaRow>, key: string): OaRow | undefined {
  const k = key.trim().toUpperCase()
  if (!k) return undefined
  return (
    lookup.get(k) ??
    (k.length === 4 && k[0] === 'K' ? lookup.get(k.slice(1)) : undefined) ??
    (k.length === 3 ? lookup.get('K' + k) : undefined)
  )
}

/** True when a CIFP key is a full ICAO identifier (4 letters, no digits). */
export function isIcaoKey(key: string): boolean {
  return /^[A-Z]{4}$/.test(key)
}

/** Count procedures by type for one airport's parse output. */
export function countProcedures(procedures: Procedure[]): { s: number; t: number; a: number } {
  let s = 0
  let t = 0
  let a = 0
  for (const p of procedures) {
    if (p.type === 'SID') s++
    else if (p.type === 'STAR') t++
    else if (p.type === 'APPROACH') a++
  }
  return { s, t, a }
}

/** Derive a 2-letter-ish state/region from an OurAirports `iso_region` ("US-WA" → "WA"). */
export function regionState(isoRegion: string | undefined): string {
  if (!isoRegion) return ''
  const parts = isoRegion.split('-')
  return (parts.length > 1 ? parts[1] : parts[0]) ?? ''
}

/**
 * Resolve display metadata + a map position for a CIFP airport. Prefers the
 * OurAirports row; when the airport is absent from OurAirports it falls back to
 * the centroid of the CIFP runway thresholds (so metro fields missing from OA
 * still get placed). Returns null only when the airport can be placed by
 * neither source (no OA row and no runway thresholds).
 */
export function deriveMetadata(key: string, data: CifpAirportData, oaRow?: OaRow): AirportMeta | null {
  if (oaRow) {
    const lat = parseFloat(oaRow.latitude_deg)
    const lon = parseFloat(oaRow.longitude_deg)
    if (!isNaN(lat) && !isNaN(lon)) {
      const elev = parseFloat(oaRow.elevation_ft)
      return {
        name: (oaRow.name || key).trim(),
        city: (oaRow.municipality || '').trim(),
        state: regionState(oaRow.iso_region),
        lat,
        lon,
        elev: isNaN(elev) ? 0 : elev,
        matched: true,
      }
    }
  }

  // CIFP fallback: centroid of runway threshold positions.
  const runways = Object.values(data.runwayInfo ?? {})
  if (runways.length === 0) return null
  let sumLat = 0
  let sumLon = 0
  let elevSum = 0
  let elevCount = 0
  for (const rw of runways) {
    sumLat += rw.lat
    sumLon += rw.lon
    if (rw.thresholdElevFt != null) {
      elevSum += rw.thresholdElevFt
      elevCount++
    }
  }
  return {
    name: key,
    city: '',
    state: '',
    lat: sumLat / runways.length,
    lon: sumLon / runways.length,
    elev: elevCount > 0 ? Math.round(elevSum / elevCount) : 0,
    matched: false,
  }
}

/**
 * Enumerate every CIFP airport that has at least one approach into an index row,
 * joined to OurAirports metadata (or the CIFP-centroid fallback). Airports with
 * zero approaches, or that cannot be placed at all, are omitted. Pure: the same
 * inputs always yield the same rows in CIFP-key-iteration order.
 */
export function enumerateAirports(
  cifpData: Record<string, CifpAirportData>,
  lookup: Map<string, OaRow>,
): AirportIndexRow[] {
  const rows: AirportIndexRow[] = []
  for (const [key, data] of Object.entries(cifpData)) {
    const counts = countProcedures(data.procedures)
    if (counts.a === 0) continue
    const meta = deriveMetadata(key, data, resolveOaRow(lookup, key))
    if (!meta) continue
    const row: AirportIndexRow = {
      key,
      ...(isIcaoKey(key) ? { icao: key } : {}),
      name: meta.name,
      city: meta.city,
      state: meta.state,
      lat: meta.lat,
      lon: meta.lon,
      elev: meta.elev,
      s: counts.s,
      t: counts.t,
      a: counts.a,
    }
    rows.push(row)
  }
  return rows
}
