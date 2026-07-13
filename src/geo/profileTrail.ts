import type { TrackPoint } from '../types/path'
import type { ProcedureTransition } from '../types/procedure'
import { alongTrackNm } from './profileMath'
import { PROFILE_TRACK_XT_MAX_NM, TRACKLOG_GAP_BREAK_MS } from '../config/constants'

export interface ProfileTrailPoint {
  distNm: number
  altFt: number
}

// Consecutive kept points further apart than this in along-track distance are
// a projection jump (the aircraft is off doing something else, or briefly
// clipped a distant part of the transition line), not a continuous trace.
const DIST_JUMP_BREAK_NM = 2

/**
 * Build the selected aircraft's flown-history trace for the vertical-profile
 * panel: projects each TrackPoint of a hex's tracklog onto the profile's
 * transition line via `alongTrackNm`, keeps only points that are laterally
 * near the approach (`xtNm <= PROFILE_TRACK_XT_MAX_NM`, dropping unrelated
 * wandering) and within the plotted distance range `[0, maxDistNm]`, then
 * splits the kept points into segments wherever consecutive points are more
 * than `TRACKLOG_GAP_BREAK_MS` apart in time (a coverage gap) or more than
 * `DIST_JUMP_BREAK_NM` apart in along-track distance (a projection jump) —
 * either way, not something that should be drawn as one continuous stroke.
 *
 * Pure function of its inputs; returns `[]` when there's no track, no
 * altitude-bearing points, or nothing survives the xt/range gates. Segments
 * of fewer than 2 points (nothing to draw a line between) are dropped.
 */
export function buildProfileTrail(
  track: readonly TrackPoint[],
  transition: ProcedureTransition,
  maxDistNm: number,
): ProfileTrailPoint[][] {
  const kept: { tMs: number; distNm: number; altFt: number }[] = []
  for (const p of track) {
    if (typeof p.altFt !== 'number') continue
    const { distNm, xtNm } = alongTrackNm(transition, p.lat, p.lon)
    if (xtNm > PROFILE_TRACK_XT_MAX_NM) continue
    if (distNm < 0 || distNm > maxDistNm) continue
    kept.push({ tMs: p.tMs, distNm, altFt: p.altFt })
  }
  if (kept.length === 0) return []

  const segments: ProfileTrailPoint[][] = []
  let current: ProfileTrailPoint[] = [{ distNm: kept[0].distNm, altFt: kept[0].altFt }]
  for (let i = 1; i < kept.length; i++) {
    const prev = kept[i - 1]
    const cur = kept[i]
    const isBreak = cur.tMs - prev.tMs > TRACKLOG_GAP_BREAK_MS || Math.abs(cur.distNm - prev.distNm) > DIST_JUMP_BREAK_NM
    if (isBreak) {
      if (current.length >= 2) segments.push(current)
      current = []
    }
    current.push({ distNm: cur.distNm, altFt: cur.altFt })
  }
  if (current.length >= 2) segments.push(current)

  return segments
}
