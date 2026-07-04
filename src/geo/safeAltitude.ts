import * as turf from '@turf/turf'
import type { Position } from 'geojson'
import type { SafeAltitudeArea, SafeAltitudeSector } from '../types/safeAltitude'

type Pt = [number, number]

const NM = { units: 'nauticalmiles' as const }

function dest(centerLat: number, centerLon: number, distNm: number, bearing: number): Pt {
  return turf.destination(turf.point([centerLon, centerLat]), distNm, bearing, NM).geometry
    .coordinates as Pt
}

/**
 * Clockwise sweep in degrees from `fromBrg` to `toBrg`, in the range (0, 360].
 * `from === to` means a full circle (360°), matching charted MSA/TAA sectors
 * that cover the whole compass.
 */
function sweepDeg(fromBrg: number, toBrg: number): number {
  const norm = ((toBrg - fromBrg) % 360 + 360) % 360
  return norm === 0 ? 360 : norm
}

/** Sample a clockwise arc from `fromBrg` to `toBrg` at radius `radiusNm`. */
function arcPoints(
  centerLat: number,
  centerLon: number,
  radiusNm: number,
  fromBrg: number,
  toBrg: number,
  stepDeg: number,
): Pt[] {
  const sweep = sweepDeg(fromBrg, toBrg)
  const steps = Math.max(1, Math.ceil(sweep / Math.max(stepDeg, 0.0001)))
  const pts: Pt[] = []
  for (let i = 0; i <= steps; i++) {
    const brg = (fromBrg + (sweep * i) / steps) % 360
    pts.push(dest(centerLat, centerLon, radiusNm, brg))
  }
  return pts
}

/**
 * Closed polygon ring for one MSA/TAA sector: a pie slice to the center when
 * `innerNm === 0`, otherwise an annulus wedge (outer arc, radial to inner,
 * inner arc back, radial closing to the outer arc's start).
 */
export function sectorPolygon(
  centerLat: number,
  centerLon: number,
  s: SafeAltitudeSector,
  stepDeg = 4,
): Position[] {
  const outerArc = arcPoints(centerLat, centerLon, s.outerNm, s.fromBrgTrue, s.toBrgTrue, stepDeg)

  if (s.innerNm <= 0) {
    const center: Pt = [centerLon, centerLat]
    return [center, ...outerArc, center]
  }

  const innerArc = arcPoints(centerLat, centerLon, s.innerNm, s.fromBrgTrue, s.toBrgTrue, stepDeg)
  const ring: Pt[] = [...outerArc, ...innerArc.slice().reverse()]
  ring.push(ring[0])
  return ring
}

/** True if a sector's angular range spans the full 360° circle. */
function isFullCircleSector(s: SafeAltitudeSector): boolean {
  return sweepDeg(s.fromBrgTrue, s.toBrgTrue) >= 360
}

function normBrg(brg: number): number {
  return ((brg % 360) + 360) % 360
}

/**
 * Line geometry for rendering an area's boundaries: one polyline per
 * distinct (radius, angular-span) arc — shared arcs between adjacent
 * step-down rings are deduped — plus radial divider segments at each
 * sector boundary bearing (skipped entirely for a single full-circle
 * sector, which has no dividers).
 */
export function sectorBoundaryLines(area: SafeAltitudeArea): Position[][] {
  const { centerLat, centerLon, sectors } = area
  const stepDeg = 4
  const lines: Position[][] = []

  const seenArcs = new Set<string>()
  const arcKey = (radiusNm: number, fromBrg: number, toBrg: number) =>
    `${radiusNm.toFixed(4)}|${normBrg(fromBrg).toFixed(2)}|${normBrg(toBrg).toFixed(2)}`

  for (const s of sectors) {
    if (s.outerNm > 0) {
      const key = arcKey(s.outerNm, s.fromBrgTrue, s.toBrgTrue)
      if (!seenArcs.has(key)) {
        seenArcs.add(key)
        lines.push(arcPoints(centerLat, centerLon, s.outerNm, s.fromBrgTrue, s.toBrgTrue, stepDeg))
      }
    }
    if (s.innerNm > 0) {
      const key = arcKey(s.innerNm, s.fromBrgTrue, s.toBrgTrue)
      if (!seenArcs.has(key)) {
        seenArcs.add(key)
        lines.push(arcPoints(centerLat, centerLon, s.innerNm, s.fromBrgTrue, s.toBrgTrue, stepDeg))
      }
    }
  }

  const skipRadials = sectors.length === 1 && isFullCircleSector(sectors[0])
  if (!skipRadials) {
    const seenRadials = new Set<string>()
    for (const s of sectors) {
      for (const brg of [normBrg(s.fromBrgTrue), normBrg(s.toBrgTrue)]) {
        const key = brg.toFixed(2)
        if (seenRadials.has(key)) continue
        seenRadials.add(key)

        // Outer/inner extent of the radial: the widest outer and narrowest
        // (nonzero) inner among sectors sharing this boundary bearing.
        const touching = sectors.filter(
          (t) => normBrg(t.fromBrgTrue) === brg || normBrg(t.toBrgTrue) === brg,
        )
        const outerNm = Math.max(...touching.map((t) => t.outerNm))
        const innerCandidates = touching.map((t) => t.innerNm).filter((v) => v > 0)
        const innerNm = innerCandidates.length > 0 ? Math.min(...innerCandidates) : 0

        lines.push([
          dest(centerLat, centerLon, innerNm, brg),
          dest(centerLat, centerLon, outerNm, brg),
        ])
      }
    }
  }

  return lines
}

/**
 * Where to place the boxed altitude label for a sector so it stays inside
 * the current map viewport (`bounds`). Samples candidate points across the
 * sector's angular span at decreasing radii, preferring the largest radius
 * that has any in-bounds sample, then the angular center of that radius's
 * longest contiguous in-bounds run. Returns null if the sector never
 * intersects the viewport.
 */
export function sectorLabelAnchor(
  centerLat: number,
  centerLon: number,
  s: SafeAltitudeSector,
  bounds: { west: number; south: number; east: number; north: number },
): [lon: number, lat: number] | null {
  const sweep = sweepDeg(s.fromBrgTrue, s.toBrgTrue)
  const angularStepDeg = 3
  const steps = Math.max(1, Math.round(sweep / angularStepDeg))
  const bearings: number[] = []
  for (let i = 0; i <= steps; i++) {
    bearings.push((s.fromBrgTrue + (sweep * i) / steps) % 360)
  }

  const minRadius = s.innerNm * 1.05
  const radiusCandidates = [
    (s.innerNm + s.outerNm) / 2,
    0.75 * s.outerNm,
    0.5 * s.outerNm,
    0.3 * s.outerNm,
  ]

  const inBounds = (lon: number, lat: number) =>
    lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north

  for (const radius of radiusCandidates) {
    if (radius < minRadius) continue

    const points = bearings.map((brg) => dest(centerLat, centerLon, radius, brg))
    const flags = points.map(([lon, lat]) => inBounds(lon, lat))
    if (!flags.some(Boolean)) continue

    let bestStart = -1
    let bestLen = 0
    let curStart = -1
    let curLen = 0
    for (let i = 0; i < flags.length; i++) {
      if (flags[i]) {
        if (curLen === 0) curStart = i
        curLen++
        if (curLen > bestLen) {
          bestLen = curLen
          bestStart = curStart
        }
      } else {
        curLen = 0
      }
    }
    if (bestLen === 0) continue

    const centerIdx = bestStart + Math.floor((bestLen - 1) / 2)
    return points[centerIdx]
  }

  return null
}

/**
 * Pick the single TAA/MSA area to render when several candidates apply to
 * the current airport. Ranking: any TAA beats any MSA; within the same
 * kind, areas with at least one visible (enabled) procedure beat areas
 * with none; remaining ties break on the highest average detected-traffic
 * count across the area's procedures; final ties keep input order.
 */
export function chooseSafeAltitudeArea(
  candidates: SafeAltitudeArea[],
  isVisible: (procId: string) => boolean,
  avgCount: (procId: string) => number,
): SafeAltitudeArea | null {
  if (candidates.length === 0) return null

  interface Score {
    kindRank: number
    anyVisible: number
    maxAvg: number
  }

  const score = (area: SafeAltitudeArea): Score => {
    const kindRank = area.kind === 'TAA' ? 1 : 0
    const anyVisible = area.procedureIds.some((id) => isVisible(id)) ? 1 : 0
    const maxAvg =
      area.procedureIds.length > 0 ? Math.max(...area.procedureIds.map((id) => avgCount(id))) : 0
    return { kindRank, anyVisible, maxAvg }
  }

  const isBetter = (a: Score, b: Score): boolean => {
    if (a.kindRank !== b.kindRank) return a.kindRank > b.kindRank
    if (a.anyVisible !== b.anyVisible) return a.anyVisible > b.anyVisible
    return a.maxAvg > b.maxAvg
  }

  let best = candidates[0]
  let bestScore = score(best)
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i]
    const candidateScore = score(candidate)
    if (isBetter(candidateScore, bestScore)) {
      best = candidate
      bestScore = candidateScore
    }
  }

  return best
}
