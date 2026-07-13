// Pure MSAW-style terrain scan over a predicted path. Terrain proximity is
// judged by actual DEM ground clearance (src/services/terrainElevation.ts);
// MVA sectors gate WHERE that matters — below an MVA floor the DEM clearance
// decides the tier, and the MVA floor itself is only used (conservatively) as
// a fallback where the DEM tile isn't cached yet. Above the MVA floor, or with
// comfortable DEM clearance below it, there's no conflict — an aircraft well
// above the ground but under the vectoring minimum (VFR beneath a Bravo shelf)
// is fine. Thresholds follow ForeFlight Hazard Advisor conventions (amber
// "alert" / red "warning").
import type { Position } from 'geojson'
import type { MvaSector } from '../utils/aixmMva'
import type { PredictedPath, PredPoint } from '../types/path'
import {
  TERRAIN_AIRPORT_EXCLUDE_FT,
  TERRAIN_AIRPORT_EXCLUDE_NM,
  TERRAIN_ALERT_CLEARANCE_FT,
  TERRAIN_LANDING_AGL_FT,
  TERRAIN_LANDING_GS_KT,
  TERRAIN_MVA_WARN_BELOW_FT,
  TERRAIN_ONAPPROACH_TOL_FT,
  TERRAIN_SCAN_HORIZON_S,
  TERRAIN_SCAN_SKIP_FIRST_S,
  TERRAIN_WARN_CLEARANCE_FT,
} from '../config/constants'

const NM_PER_DEG_LAT = 60.04 // close enough for a few-nm proximity check

export interface TerrainScanOpts {
  /** True when the aircraft has a confirmed approach assignment this poll. */
  onApproach: boolean
  /** |altNow - expected profile alt| when onApproach, else null. */
  profileDeviationFt: number | null
  /** Known airports (active + nearby) — arrival/departure exclusion volumes. */
  airports: { lat: number; lon: number; elevationFt: number }[]
  /** Current groundspeed (kt). */
  gsKt: number
  /** AGL above the ACTUAL ground (DEM/nearest-airport-elev fallback) at the
   *  aircraft's CURRENT position; null when unresolvable (e.g. cold DEM tile
   *  and no fallback elevation). */
  currentAglFt: number | null
}

interface SectorBbox {
  sector: MvaSector
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

// Per-poll scans are called with the same `sectors` array reference (loaded
// once per airport), so bboxes are computed once and reused for the array's
// lifetime rather than recomputed on every scan/point.
const bboxCache = new WeakMap<readonly MvaSector[], SectorBbox[]>()

function bboxesFor(sectors: readonly MvaSector[]): SectorBbox[] {
  const cached = bboxCache.get(sectors)
  if (cached) return cached

  const bboxes = sectors.map((sector) => {
    let minLon = Infinity
    let minLat = Infinity
    let maxLon = -Infinity
    let maxLat = -Infinity
    for (const [lon, lat] of sector.polygon[0]) {
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
    return { sector, minLon, minLat, maxLon, maxLat }
  })
  bboxCache.set(sectors, bboxes)
  return bboxes
}

function inBbox(b: SectorBbox, lat: number, lon: number): boolean {
  return lon >= b.minLon && lon <= b.maxLon && lat >= b.minLat && lat <= b.maxLat
}

/** Standard ray-casting point-in-ring test (even-odd rule). */
function pointInRing(lat: number, lon: number, ring: Position[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const crosses = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

/** Inside the exterior ring and outside every hole. */
function pointInSector(lat: number, lon: number, sector: MvaSector): boolean {
  const [exterior, ...holes] = sector.polygon
  if (!pointInRing(lat, lon, exterior)) return false
  for (const hole of holes) {
    if (pointInRing(lat, lon, hole)) return false
  }
  return true
}

/** Cheap planar approximation — good enough for a 2 nm proximity gate. */
function roughNmBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (aLat - bLat) * NM_PER_DEG_LAT
  const dLon = (aLon - bLon) * NM_PER_DEG_LAT * Math.cos((aLat * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLon * dLon)
}

/**
 * MSAW-style approach/departure exclusion: a sample within
 * TERRAIN_AIRPORT_EXCLUDE_NM of any known airport and below that airport's field
 * elevation + TERRAIN_AIRPORT_EXCLUDE_FT is a normal arrival/departure, not a
 * terrain conflict — excluded regardless of assignment.
 */
function inAirportExclusion(
  point: PredPoint,
  airports: TerrainScanOpts['airports'],
): boolean {
  for (const airport of airports) {
    if (roughNmBetween(point.lat, point.lon, airport.lat, airport.lon) <= TERRAIN_AIRPORT_EXCLUDE_NM) {
      if (point.altFt < airport.elevationFt + TERRAIN_AIRPORT_EXCLUDE_FT) return true
    }
  }
  return false
}

/**
 * Scans a predicted path for terrain conflicts. Returns the worst tier found
 * ('warning' short-circuits immediately since nothing outranks it; otherwise
 * 'alert' if any point violated the shallower threshold), or null if clear.
 *
 * Three suppressions apply: (1) a TAWS-style landing-configuration inhibit —
 * slow AND low above the actual ground means landing/departing at SOME strip,
 * charted or not, so it's checked first and short-circuits the whole scan;
 * (2) an on-approach profile-deviation short-circuit — an aircraft tracking
 * its descent profile within TERRAIN_ONAPPROACH_TOL_FT is descending toward
 * terrain by design; and (3) an unconditional MSAW-style airport-exclusion
 * volume (inAirportExclusion) that drops samples near ANY known airport below
 * field-elev + TERRAIN_AIRPORT_EXCLUDE_FT, so normal arrivals/departures at
 * non-active fields (e.g. a KSEA arrival while only KPAE is active) don't fire.
 */
export function scanTerrain(
  pred: PredictedPath,
  sectors: readonly MvaSector[],
  elevAt: (lat: number, lon: number) => number | undefined,
  opts: TerrainScanOpts,
): 'alert' | 'warning' | null {
  // TAWS-style landing-config inhibit: covers strips absent from the airport
  // index (no MSAW exclusion volume above) — a slow aircraft close above the
  // real ground is landing or departing, not flying into terrain. Requires a
  // resolved currentAglFt (null on a cold DEM tile with no fallback elevation
  // falls through to the normal scan rather than assuming safety).
  if (opts.gsKt < TERRAIN_LANDING_GS_KT && opts.currentAglFt !== null && opts.currentAglFt < TERRAIN_LANDING_AGL_FT) {
    return null
  }

  if (
    opts.onApproach &&
    opts.profileDeviationFt !== null &&
    opts.profileDeviationFt <= TERRAIN_ONAPPROACH_TOL_FT
  ) {
    return null
  }

  const bboxes = bboxesFor(sectors)
  let worst: 'alert' | 'warning' | null = null

  for (const point of pred.points) {
    // Short look-ahead window: beyond TERRAIN_SCAN_HORIZON_S a descending
    // aircraft will typically have leveled off, so extrapolating its baro rate
    // further just projects phantom MVA penetrations (real MSAW look-ahead is
    // shorter still).
    if (point.tSec <= TERRAIN_SCAN_SKIP_FIRST_S || point.tSec > TERRAIN_SCAN_HORIZON_S) continue
    if (inAirportExclusion(point, opts.airports)) continue

    const containing = bboxes.filter(
      (b) => inBbox(b, point.lat, point.lon) && pointInSector(point.lat, point.lon, b.sector),
    )

    if (containing.length > 0) {
      const minAltFt = Math.min(...containing.map((c) => c.sector.minAltFt))
      if (point.altFt >= minAltFt) continue // above the vectoring floor — clear.
      // Below the MVA floor. The floor is a minimum VECTORING altitude
      // (highest obstacle + ~1000 ft + airspace buffers), NOT ground
      // proximity — an aircraft can be far below it yet comfortably above the
      // actual terrain (e.g. VFR under a Bravo shelf over flat ground, the
      // FFL640 case). Corroborate with the real DEM ground clearance and let
      // it win: only when DEM confirms marginal clearance — or DEM is cold —
      // does the MVA penetration stand.
      const groundFt = elevAt(point.lat, point.lon)
      if (groundFt !== undefined) {
        const clearanceFt = point.altFt - groundFt
        if (clearanceFt < TERRAIN_WARN_CLEARANCE_FT) return 'warning'
        if (clearanceFt < TERRAIN_ALERT_CLEARANCE_FT) worst = 'alert'
        // else: good ground clearance → below-MVA is not a terrain conflict.
      } else {
        // DEM tile not cached — fall back to the conservative MVA-floor logic.
        if (point.altFt < minAltFt - TERRAIN_MVA_WARN_BELOW_FT) return 'warning'
        worst = 'alert'
      }
      continue
    }

    const groundFt = elevAt(point.lat, point.lon)
    if (groundFt === undefined) continue // tile not cached yet — skip, retry next poll

    const clearanceFt = point.altFt - groundFt
    if (clearanceFt < TERRAIN_WARN_CLEARANCE_FT) return 'warning'
    if (clearanceFt < TERRAIN_ALERT_CLEARANCE_FT) worst = 'alert'
  }

  return worst
}
