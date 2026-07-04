/**
 * ARINC 424-18 airport-section record parsers used by the CIFP worker.
 *
 * Every function takes a single 132-char record line and is pure/unit-testable.
 * Column offsets below are 1-based (matching the ARINC 424 spec and the FAA
 * CIFP field tables) and were verified against live FAA CIFP data (cycle
 * 2026-03-19): FAACIFP18 airport records carry the subsection code at column 13.
 *
 * All bearings parsed here are stored as read (still magnetic when the record's
 * Magnetic/True indicator is 'M'); callers convert to true with
 * `magneticToTrue` once the airport magnetic variation is known.
 */

import { MSA_DEFAULT_RADIUS_NM, FEET_PER_METER } from '../config/constants'
import type { SafeAltitudeArea, SafeAltitudeSector } from '../types/safeAltitude'

// TAA straight-in areas default to 30nm when a sector omits its radius. FAA
// CIFP does not currently ship TAA (PK) records, but the parser handles them
// for other ARINC 424 sources.
const TAA_DEFAULT_RADIUS_NM = 30

// --- raw record shapes (bearings still magnetic) --------------------------

export interface MsaSectorRaw {
  fromBrg: number
  toBrg: number
  altitudeFt: number
  radiusNm: number | null // null => use MSA_DEFAULT_RADIUS_NM
}

export interface MsaRawRecord {
  icao: string
  centerFixId: string
  magnetic: boolean
  sectors: MsaSectorRaw[]
}

export interface TaaSectorRaw {
  fromBrg: number
  toBrg: number
  altitudeFt: number
  radiusNm: number | null
}

export interface TaaRawRecord {
  icao: string
  approachId: string
  waypointId: string
  magnetic: boolean
  sectors: TaaSectorRaw[]
}

export interface PathPointRecord {
  icao: string
  approachId: string
  runwayId: string
  gpaDeg: number | null
  tchFt: number | null
}

export interface IlsGsFields {
  icao: string
  locId: string
  runwayId: string // runway designator with any 'RW' prefix stripped (e.g. '16L')
  gsAngleDeg: number | null
  gsTchFt: number | null
}

export interface RunwayExtras {
  icao: string
  runwayId: string // e.g. 'RW16C'
  lengthFt: number | null
  thresholdElevFt: number | null
}

// --- small helpers --------------------------------------------------------

/** parseInt of a fixed-width field; blank or non-numeric => null. */
function fieldInt(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = parseInt(t, 10)
  return Number.isNaN(n) ? null : n
}

/** Normalize a bearing/heading to the [0, 360) range. */
function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/**
 * Convert a magnetic bearing to true using the airport magnetic variation
 * (east positive, west negative). True = Magnetic + Variation(E). A null
 * variation leaves the bearing unchanged.
 */
export function magneticToTrue(brgMag: number, magVarDeg: number | null): number {
  return norm360(brgMag + (magVarDeg ?? 0))
}

// --- PA: airport reference (magnetic variation) ---------------------------

/**
 * Airport magnetic variation from an Airport (PA) primary record.
 * Cols 52-56: hemisphere letter + 4 digits in tenths of a degree
 * (e.g. 'E0160' => +16.0, 'W0110' => -11.0). Returns null if absent.
 */
export function parseAirportMagVar(line: string): number | null {
  if (line.length < 56) return null
  const field = line.slice(51, 56).trim()
  if (field.length < 2) return null
  const hemi = field[0]
  const digits = field.slice(1)
  const n = parseInt(digits, 10)
  if (Number.isNaN(n)) return null
  const deg = n / 10
  return hemi === 'W' ? -deg : deg
}

// --- PG: runway length + landing threshold elevation ----------------------

/**
 * Runway length (cols 23-27, feet) and landing threshold elevation
 * (cols 67-71, feet MSL) from a Runway (PG) primary record.
 */
export function parseRunwayExtras(line: string): RunwayExtras | null {
  if (line.length < 132 || line[4] !== 'P' || line[12] !== 'G') return null
  const icao = line.slice(6, 10).trim()
  const runwayId = line.slice(13, 18).trim()
  if (!icao || !runwayId) return null
  const lengthFt = fieldInt(line.slice(22, 27)) || null
  const thrRaw = line.slice(66, 71).trim()
  const thresholdElevFt = thrRaw === '' ? null : fieldInt(thrRaw)
  return { icao, runwayId, lengthFt, thresholdElevFt }
}

// --- PI: localizer / glide slope ------------------------------------------

/**
 * ILS glide-slope angle (cols 88-90, hundredths of a degree => 300 = 3.00°)
 * and glide-slope threshold crossing height (cols 96-97, feet) from a
 * Localizer/Glide Slope (PI) primary record. LOC-only records leave these
 * blank => null. Also captures the localizer id (cols 14-17) and the served
 * runway (cols 28-32, 'RW' stripped) so approaches can be linked by runway.
 */
export function parseIlsGsFields(line: string): IlsGsFields | null {
  if (line.length < 132 || line[4] !== 'P' || line[12] !== 'I') return null
  const icao = line.slice(6, 10).trim()
  const locId = line.slice(13, 17).trim()
  if (!icao || !locId) return null
  const runwayId = line.slice(27, 32).trim().replace(/^RW/, '')
  const gsRaw = fieldInt(line.slice(87, 90))
  const gsAngleDeg = gsRaw && gsRaw > 0 ? gsRaw / 100 : null
  const tchRaw = fieldInt(line.slice(95, 97))
  const gsTchFt = tchRaw && tchRaw > 0 ? tchRaw : null
  return { icao, locId, runwayId, gsAngleDeg, gsTchFt }
}

// --- PP: path point (RNAV glide path) -------------------------------------

/**
 * True glide-path angle (cols 67-70, hundredths of a degree => 0300 = 3.00°)
 * and threshold crossing height (cols 103-108, tenths; units at col 109,
 * 'F'=feet/'M'=meters) from a Path Point (PP) primary record. These exist for
 * RNAV (LPV/LNAV-VNAV) approaches only. The approach ident (cols 14-19)
 * matches the SID/STAR/Approach procedure identifier exactly.
 */
export function parsePathPointRecord(line: string): PathPointRecord | null {
  if (line.length < 132 || line[4] !== 'P' || line[12] !== 'P') return null
  // Skip continuation records (col 27 holds the continuation number).
  if (!'01'.includes(line[26])) return null
  const icao = line.slice(6, 10).trim()
  const approachId = line.slice(13, 19).trim()
  const runwayId = line.slice(19, 24).trim()
  if (!icao || !approachId) return null

  const gpaRaw = fieldInt(line.slice(66, 70))
  const gpaDeg = gpaRaw && gpaRaw > 0 ? gpaRaw / 100 : null

  const tchRaw = fieldInt(line.slice(102, 108))
  let tchFt: number | null = null
  if (tchRaw && tchRaw > 0) {
    const tenths = tchRaw / 10
    tchFt = line[108] === 'M' ? tenths * FEET_PER_METER : tenths
  }

  return { icao, approachId, runwayId, gpaDeg, tchFt }
}

// --- PS: minimum sector altitude (MSA) ------------------------------------

/**
 * Minimum Sector Altitude (PS) primary record.
 * Center fix cols 14-18; Magnetic/True indicator col 120. Up to 7 sector
 * groups start at col 43, each 11 chars: bearing-from (3), bearing-to (3),
 * altitude (3, hundreds of feet), radius (2, nm — blank => default 25nm).
 */
export function parseMsaRecord(line: string): MsaRawRecord | null {
  if (line.length < 132 || line[4] !== 'P' || line[12] !== 'S') return null
  // Skip continuation records (col 39 holds the continuation number).
  if (!'01'.includes(line[38])) return null
  const icao = line.slice(6, 10).trim()
  const centerFixId = line.slice(13, 18).trim()
  if (!icao || !centerFixId) return null
  const magnetic = line[119] !== 'T'

  const sectors: MsaSectorRaw[] = []
  // Sector group start indices (0-based): col 43 => index 42, stride 11.
  for (const base of [42, 53, 64, 75, 86, 97, 108]) {
    const fromS = line.slice(base, base + 3)
    if (fromS.trim() === '') break
    const from = parseInt(fromS, 10)
    const to = parseInt(line.slice(base + 3, base + 6), 10)
    const altRaw = parseInt(line.slice(base + 6, base + 9), 10)
    if (Number.isNaN(from) || Number.isNaN(to) || Number.isNaN(altRaw)) continue
    const radStr = line.slice(base + 9, base + 11).trim()
    sectors.push({
      fromBrg: from,
      toBrg: to,
      altitudeFt: altRaw * 100,
      radiusNm: radStr === '' ? null : parseInt(radStr, 10),
    })
  }
  return { icao, centerFixId, magnetic, sectors }
}

// --- PK: terminal arrival area (TAA) --------------------------------------

/**
 * Terminal Arrival Area (PK) primary record.
 * Approach ident cols 14-19; TAA waypoint cols 20-24; Magnetic/True indicator
 * col 41. Up to 6 sector groups start at col 42, each 13 chars: radius
 * (4, tenths of nm), bearing-from (3), bearing-to (3), altitude (3, hundreds
 * of feet). Step-down (inner-ring) sub-sectors live on continuation records
 * and are intentionally not parsed here — only the outer sectors are shipped.
 */
export function parseTaaRecord(line: string): TaaRawRecord | null {
  if (line.length < 132 || line[4] !== 'P' || line[12] !== 'K') return null
  // Skip continuation records (col 30 holds the continuation number).
  if (!'01'.includes(line[29])) return null
  const icao = line.slice(6, 10).trim()
  const approachId = line.slice(13, 19).trim()
  const waypointId = line.slice(19, 24).trim()
  if (!icao || !approachId) return null
  const magnetic = line[40] !== 'T'

  const sectors: TaaSectorRaw[] = []
  // Sector group start indices (0-based): col 42 => index 41, stride 13.
  for (const base of [41, 54, 67, 80, 93, 106]) {
    const radS = line.slice(base, base + 4)
    const fromS = line.slice(base + 4, base + 7)
    if (radS.trim() === '' && fromS.trim() === '') break
    const from = parseInt(fromS, 10)
    const to = parseInt(line.slice(base + 7, base + 10), 10)
    const altRaw = parseInt(line.slice(base + 10, base + 13), 10)
    if (Number.isNaN(from) || Number.isNaN(to) || Number.isNaN(altRaw)) continue
    const rad = parseInt(radS, 10)
    sectors.push({
      fromBrg: from,
      toBrg: to,
      altitudeFt: altRaw * 100,
      radiusNm: Number.isNaN(rad) ? null : rad / 10,
    })
  }
  return { icao, approachId, waypointId, magnetic, sectors }
}

// --- assembly -------------------------------------------------------------

/**
 * Turn raw MSA/TAA records into resolved `SafeAltitudeArea`s with true
 * bearings and center coordinates.
 *
 * @param resolveFix               looks a fix/navaid/runway/airport id up to a position
 * @param magVarDeg                airport magnetic variation (east +, west -), for M records
 * @param approachIdsForCenterFix  approaches referencing an MSA center fix (default none)
 */
export function buildSafeAltitudeAreas(
  msaRaws: MsaRawRecord[],
  taaRaws: TaaRawRecord[],
  resolveFix: (fixId: string) => { lat: number; lon: number } | null,
  magVarDeg: number | null,
  approachIdsForCenterFix: (centerFixId: string) => string[] = () => [],
): SafeAltitudeArea[] {
  const areas: SafeAltitudeArea[] = []

  for (const raw of msaRaws) {
    const center = resolveFix(raw.centerFixId)
    if (!center || raw.sectors.length === 0) continue
    const conv = (brg: number) => (raw.magnetic ? magneticToTrue(brg, magVarDeg) : norm360(brg))
    const sectors: SafeAltitudeSector[] = raw.sectors.map((s) => ({
      fromBrgTrue: conv(s.fromBrg),
      toBrgTrue: conv(s.toBrg),
      innerNm: 0,
      outerNm: s.radiusNm ?? MSA_DEFAULT_RADIUS_NM,
      altitudeFt: s.altitudeFt,
    }))
    areas.push({
      kind: 'MSA',
      icao: raw.icao,
      procedureIds: approachIdsForCenterFix(raw.centerFixId),
      centerFixId: raw.centerFixId,
      centerLat: center.lat,
      centerLon: center.lon,
      sectors,
    })
  }

  for (const raw of taaRaws) {
    const center = resolveFix(raw.waypointId) ?? resolveFix(raw.icao)
    if (!center || raw.sectors.length === 0) continue
    const conv = (brg: number) => (raw.magnetic ? magneticToTrue(brg, magVarDeg) : norm360(brg))
    const sectors: SafeAltitudeSector[] = raw.sectors.map((s) => ({
      fromBrgTrue: conv(s.fromBrg),
      toBrgTrue: conv(s.toBrg),
      innerNm: 0,
      outerNm: s.radiusNm ?? TAA_DEFAULT_RADIUS_NM,
      altitudeFt: s.altitudeFt,
    }))
    areas.push({
      kind: 'TAA',
      icao: raw.icao,
      procedureIds: [raw.approachId],
      centerFixId: raw.waypointId,
      centerLat: center.lat,
      centerLon: center.lon,
      sectors,
    })
  }

  return areas
}
