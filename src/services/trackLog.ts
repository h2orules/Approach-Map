import type { InterpolatedAircraft } from '../types/aircraft'
import type { TrackPoint } from '../types/path'
import { TRACKLOG_MAX_POINTS } from '../config/constants'

// Non-reactive, module-level flown-path store. Deliberately NOT a zustand
// store: it's appended to once per ADS-B poll and read imperatively (not via
// React re-renders) by the path-prediction engine and the tracklog map layer,
// so there's no need to pay for subscription/notification machinery here.
//
// Memory bound: one ring buffer per tracked hex, each a fixed-length
// TrackPoint[] of capacity TRACKLOG_MAX_POINTS (720). The array is
// preallocated on first write, so per-hex memory is bounded and doesn't grow
// with session length — old points are overwritten in place, not shifted.
// Total footprint is O(activeHexCount × TRACKLOG_MAX_POINTS), and hexes gone
// from the latest poll are pruned in the same recordPoll call.

interface Ring {
  points: (TrackPoint | undefined)[]
  head: number // index the NEXT write goes to
  size: number // number of valid entries (<= capacity)
}

const rings = new Map<string, Ring>()

function newRing(): Ring {
  return { points: new Array(TRACKLOG_MAX_POINTS), head: 0, size: 0 }
}

function lastPoint(ring: Ring): TrackPoint | undefined {
  if (ring.size === 0) return undefined
  const idx = (ring.head - 1 + TRACKLOG_MAX_POINTS) % TRACKLOG_MAX_POINTS
  return ring.points[idx]
}

function push(ring: Ring, point: TrackPoint): void {
  ring.points[ring.head] = point
  ring.head = (ring.head + 1) % TRACKLOG_MAX_POINTS
  ring.size = Math.min(ring.size + 1, TRACKLOG_MAX_POINTS)
}

/** Chronological (oldest -> newest) snapshot of a ring's contents. */
function toChronological(ring: Ring): TrackPoint[] {
  if (ring.size === 0) return []
  const out: TrackPoint[] = new Array(ring.size)
  // Oldest entry is at `head` when the ring is full; when not yet full it's
  // simply index 0 (head hasn't wrapped).
  const start = ring.size < TRACKLOG_MAX_POINTS ? 0 : ring.head
  for (let i = 0; i < ring.size; i++) {
    const idx = (start + i) % TRACKLOG_MAX_POINTS
    out[i] = ring.points[idx] as TrackPoint
  }
  return out
}

/**
 * Append one TrackPoint per aircraft (deduped on lastPollMs) and prune ring
 * buffers for hexes no longer present in the aircraft map. Call once per
 * poll round.
 */
export function recordPoll(aircraftMap: Map<string, InterpolatedAircraft>, _pollMs: number): void {
  for (const [hex, ac] of aircraftMap) {
    if (!Number.isFinite(ac.lat) || !Number.isFinite(ac.lon)) continue

    let ring = rings.get(hex)
    const prevLast = ring ? lastPoint(ring) : undefined
    if (prevLast && ac.lastPollMs <= prevLast.tMs) continue // dedupe stale-carried poll

    if (!ring) {
      ring = newRing()
      rings.set(hex, ring)
    }

    push(ring, {
      tMs: ac.lastPollMs,
      lat: ac.lat,
      lon: ac.lon,
      altFt: ac.altBaro,
      gs: ac.groundspeed,
      track: ac.track,
      baroRate: ac.baroRate,
    })
  }

  // Drop ring buffers for hexes no longer tracked.
  for (const hex of rings.keys()) {
    if (!aircraftMap.has(hex)) rings.delete(hex)
  }
}

/** Full chronological (oldest -> newest) track for a hex; empty if unknown. */
export function getTrack(hex: string): readonly TrackPoint[] {
  const ring = rings.get(hex)
  if (!ring) return []
  return toChronological(ring)
}

/** Last `n` points for a hex, chronological (oldest -> newest). */
export function getRecent(hex: string, n: number): TrackPoint[] {
  const ring = rings.get(hex)
  if (!ring || n <= 0) return []
  const full = toChronological(ring)
  return full.slice(Math.max(0, full.length - n))
}

/** Test helper: clear all tracked rings. */
export function _reset(): void {
  rings.clear()
}
