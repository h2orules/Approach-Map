import type { Runway } from '../../src/types/airport'
import type { AirportIndexRow } from './airportIndex'

/**
 * Pure validation predicates for the compiled static data. Every predicate
 * takes one record and returns a list of human-readable issue strings (empty =
 * valid), so scripts/validateStaticData.ts can aggregate counts and first-N
 * samples without any I/O. Unit-tested independently of the build.
 */

/** A per-airport shard file (public/data/airports/{key}.json). */
export interface AirportShard {
  key: string
  icao?: string
  name: string
  city: string
  state: string
  lat: number
  lon: number
  elev: number
  runways: Runway[]
}

/**
 * Bounding boxes covering the US and its territories: [minLat, maxLat, minLon,
 * maxLon]. A coordinate is "US-plausible" if it falls in any box. Deliberately
 * generous — the coord check is a sanity net for parse/join bugs (points in the
 * ocean or the wrong hemisphere), not a precise geofence.
 */
const US_BOXES: Array<[number, number, number, number]> = [
  [24, 50, -125, -66], // CONUS
  [50, 72, -180, -129], // Alaska mainland
  [50, 56, 172, 180], // Aleutians west of the antimeridian
  [18, 23, -161, -154], // Hawaii
  [17, 19, -68, -64], // Puerto Rico + USVI
  [13, 21, 144, 147], // Guam + CNMI
  [-15, -13, -171, -168], // American Samoa
  [27, 29, -178, -176], // Midway
  [18, 20, 166, 167], // Wake Island
]

export function isUsCoord(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false
  for (const [minLat, maxLat, minLon, maxLon] of US_BOXES) {
    if (lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon) return true
  }
  return false
}

/** Great-circle distance in nautical miles (haversine). */
export function distNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 3440.065 // nm
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Validate one airport-index row against the emitted schema + coord sanity. */
export function validateIndexRow(row: AirportIndexRow): string[] {
  const issues: string[] = []
  if (typeof row.key !== 'string' || row.key.trim() === '') issues.push('key: empty')
  if (row.icao !== undefined && !/^[A-Z]{4}$/.test(row.icao)) issues.push(`icao: not 4-letter (${row.icao})`)
  if (!isFiniteNum(row.lat) || row.lat < -90 || row.lat > 90) issues.push(`lat: out of range (${row.lat})`)
  if (!isFiniteNum(row.lon) || row.lon < -180 || row.lon > 180) issues.push(`lon: out of range (${row.lon})`)
  if (isFiniteNum(row.lat) && isFiniteNum(row.lon) && !isUsCoord(row.lat, row.lon)) {
    issues.push(`coord: outside US/territory bounds (${row.lat},${row.lon})`)
  }
  if (!isFiniteNum(row.elev)) issues.push(`elev: not finite (${row.elev})`)
  for (const f of ['s', 't', 'a'] as const) {
    const v = row[f]
    if (!Number.isInteger(v) || v < 0) issues.push(`${f}: not a non-negative integer (${v})`)
  }
  if (Number.isInteger(row.a) && row.a <= 0) issues.push('a: must be > 0 (rows are approach-bearing only)')
  return issues
}

/** Validate one runway object from a shard. */
export function validateRunway(rw: Runway, ctx = ''): string[] {
  const p = ctx ? `${ctx} ` : ''
  const issues: string[] = []
  if (typeof rw.id !== 'string' || rw.id.trim() === '') issues.push(`${p}runway.id: empty`)
  if (!isFiniteNum(rw.lengthFt) || rw.lengthFt <= 0) issues.push(`${p}runway.lengthFt: not > 0 (${rw.lengthFt})`)
  for (const [label, end] of [['lowEnd', rw.lowEnd], ['highEnd', rw.highEnd]] as const) {
    if (!end) {
      issues.push(`${p}runway.${label}: missing`)
      continue
    }
    if (!isFiniteNum(end.heading) || end.heading < 0 || end.heading > 360) {
      issues.push(`${p}runway.${label}.heading: out of 0..360 (${end.heading})`)
    }
    if (!isFiniteNum(end.lat) || !isFiniteNum(end.lon)) {
      issues.push(`${p}runway.${label}: NaN coord`)
    }
  }
  return issues
}

/** Validate one per-airport shard against the emitted schema. */
export function validateShard(shard: AirportShard): string[] {
  const issues: string[] = []
  if (typeof shard.key !== 'string' || shard.key.trim() === '') issues.push('key: empty')
  if (shard.icao !== undefined && !/^[A-Z]{4}$/.test(shard.icao)) issues.push(`icao: not 4-letter (${shard.icao})`)
  if (!isFiniteNum(shard.lat) || shard.lat < -90 || shard.lat > 90) issues.push(`lat: out of range (${shard.lat})`)
  if (!isFiniteNum(shard.lon) || shard.lon < -180 || shard.lon > 180) issues.push(`lon: out of range (${shard.lon})`)
  if (isFiniteNum(shard.lat) && isFiniteNum(shard.lon) && !isUsCoord(shard.lat, shard.lon)) {
    issues.push(`coord: outside US/territory bounds (${shard.lat},${shard.lon})`)
  }
  if (!Array.isArray(shard.runways)) {
    issues.push('runways: not an array')
  } else {
    shard.runways.forEach((rw, i) => issues.push(...validateRunway(rw, `[${i}]`)))
  }
  return issues
}

/**
 * Cross-check that a shard's position is within `maxNm` of its index row (they
 * are derived by the same code, so a large gap signals a build bug). Also flags
 * a key mismatch. Returns issue strings.
 */
export function crossCheckCoord(
  row: Pick<AirportIndexRow, 'key' | 'lat' | 'lon'>,
  shard: Pick<AirportShard, 'key' | 'lat' | 'lon'>,
  maxNm = 10,
): string[] {
  const issues: string[] = []
  if (row.key !== shard.key) issues.push(`key mismatch: index ${row.key} vs shard ${shard.key}`)
  const d = distNm(row.lat, row.lon, shard.lat, shard.lon)
  if (!Number.isFinite(d) || d > maxNm) issues.push(`coord drift: ${d.toFixed(1)}nm between index and shard`)
  return issues
}
