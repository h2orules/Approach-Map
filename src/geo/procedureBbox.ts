import type { Procedure } from '../types/procedure'
import { buildArcMatchPaths, buildHoldMatchPaths } from './procedureMatch'

/**
 * Axis-aligned lat/lon bounding box around a procedure's waypoints, padded so a
 * point that could ever produce cross-track evidence in `evaluateMatch` is
 * always inside it. Used purely as a cheap per-poll prefilter in the detection
 * reducer: an aircraft far outside every procedure's box can't start a NEW
 * track, so the expensive line-matching math is skipped for it. Existing
 * candidate/confirmed tracks are never gated by the box (they age via TTL), so
 * the prefilter can only skip work — never change a result.
 */
export interface ProcBbox {
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
}

/**
 * Compute the padded box from a procedure's waypoints. Returns null when the
 * procedure has no usable geometry (< 2 points or `!hasGeometry`) — mirrors
 * `prepareProcedure`, which also yields null in that case, so such procedures
 * produce no evidence and the prefilter is a no-op for them.
 *
 * The latitude pad is `padNm / 60` (1 nm ≈ 1/60°). The longitude pad divides by
 * `cos(lat)` using the box's MAXIMUM |lat| — smaller cos → larger lon pad — so
 * the box is conservative (never narrower than needed) at every latitude it
 * spans. `cos` is clamped to a small floor to avoid a blow-up near the poles.
 */
export function computeProcedureBbox(proc: Procedure, padNm: number): ProcBbox | null {
  if (!proc.hasGeometry || proc.waypoints.length < 2) return null

  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity
  const grow = (lon: number, lat: number) => {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
  }
  for (const w of proc.waypoints) grow(w.lon, w.lat)
  // DME-arc feeders live off the representative path `waypoints` describes
  // (KPAE VOR-A's CEVLI arc sits east of the box built from the final segment
  // alone), so an aircraft established on the arc would be prefiltered out
  // before it could ever match. Fold the sampled arc points into the box so
  // detection matches the same geometry `evaluateMatch` does.
  for (const path of buildArcMatchPaths(proc)) {
    for (const [lon, lat] of path.coords) grow(lon, lat)
  }
  // Hold racetracks extend a few nm off their fix (up to ~a leg length plus a
  // turn diameter) and are matched with a 2 nm cross-track — fold their points
  // in too so a holding aircraft near the box edge isn't prefiltered out.
  for (const hold of buildHoldMatchPaths(proc)) {
    for (const [lon, lat] of hold.coords) grow(lon, lat)
  }

  const dLat = padNm / 60
  const maxAbsLat = Math.max(Math.abs(minLat), Math.abs(maxLat))
  const cosLat = Math.max(Math.cos((maxAbsLat * Math.PI) / 180), 0.01)
  const dLon = padNm / (60 * cosLat)

  return {
    minLat: minLat - dLat,
    maxLat: maxLat + dLat,
    minLon: minLon - dLon,
    maxLon: maxLon + dLon,
  }
}

export function isInsideBbox(b: ProcBbox, lat: number, lon: number): boolean {
  return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon
}

const bboxCache = new WeakMap<Procedure, ProcBbox | null>()

/**
 * Memoized `computeProcedureBbox`, keyed by procedure identity — safe because
 * `procedures` is replaced (new objects) when the airport or AIRAC cycle
 * changes, mirroring `prepareProcedure`'s `prepCache`. The pad must be stable
 * across the cache's lifetime (it is — a single module-level constant feeds it);
 * a per-procedure box is computed at most once per procedure-set change.
 */
export function getProcedureBbox(proc: Procedure, padNm: number): ProcBbox | null {
  const cached = bboxCache.get(proc)
  if (cached !== undefined) return cached
  const result = computeProcedureBbox(proc, padNm)
  bboxCache.set(proc, result)
  return result
}
