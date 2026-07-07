import * as turf from '@turf/turf'
import type { Runway, RunwayEnd } from '../types/airport'
import type { CifpRunwayInfo } from '../types/cifp'

// Width isn't carried in CIFP runway records; use a typical value so the drawn
// runway polygon has sensible thickness. (Only affects the visual buffer.)
const DEFAULT_RUNWAY_WIDTH_FT = 150

/** Reciprocal runway ident, e.g. 16C -> 34C, 08 -> 26, 09L -> 27R. */
function reciprocalIdent(ident: string): string | null {
  const m = /^(\d{1,2})([LRC]?)$/.exec(ident)
  if (!m) return null
  const num = parseInt(m[1], 10)
  if (num < 1 || num > 36) return null
  const recNum = ((num + 18 - 1) % 36) + 1
  const side = m[2] === 'L' ? 'R' : m[2] === 'R' ? 'L' : m[2]
  return `${String(recNum).padStart(2, '0')}${side}`
}

/**
 * Synthesize `Runway[]` (matching public/data/runways.json's shape) from CIFP
 * runway-threshold records, so airports missing from the curated runway data
 * still render runways/centerlines. Opposing thresholds (e.g. RW16C + RW34C)
 * are paired into one runway; headings are derived from the threshold
 * coordinates. A single-ended runway (no reciprocal threshold in the data) is
 * skipped — the far end can't be placed.
 */
export function synthesizeRunways(runwayInfo: Record<string, CifpRunwayInfo>): Runway[] {
  const byIdent = new Map<string, CifpRunwayInfo>()
  for (const info of Object.values(runwayInfo)) {
    byIdent.set(info.id.replace(/^RW/, ''), info)
  }

  const seen = new Set<string>()
  const runways: Runway[] = []

  for (const [ident, info] of byIdent) {
    if (seen.has(ident)) continue
    const recip = reciprocalIdent(ident)
    if (!recip) continue
    const recipInfo = byIdent.get(recip)
    seen.add(ident)
    if (recipInfo) seen.add(recip)
    if (!recipInfo) continue // can't place the far threshold

    // Order low/high by runway number for a stable "NN/MM" id.
    const [lowIdent, lowInfo, highIdent, highInfo] =
      parseInt(recip, 10) < parseInt(ident, 10)
        ? [recip, recipInfo, ident, info]
        : [ident, info, recip, recipInfo]

    const bearing =
      (turf.bearing(turf.point([lowInfo.lon, lowInfo.lat]), turf.point([highInfo.lon, highInfo.lat])) + 360) % 360

    const lowEnd: RunwayEnd = {
      id: lowIdent,
      heading: bearing,
      lat: lowInfo.lat,
      lon: lowInfo.lon,
      displacedThresholdFt: 0,
    }
    const highEnd: RunwayEnd = {
      id: highIdent,
      heading: (bearing + 180) % 360,
      lat: highInfo.lat,
      lon: highInfo.lon,
      displacedThresholdFt: 0,
    }

    runways.push({
      id: `${lowIdent}/${highIdent}`,
      lengthFt: lowInfo.lengthFt ?? highInfo.lengthFt ?? 0,
      widthFt: DEFAULT_RUNWAY_WIDTH_FT,
      surfaceCode: '',
      lowEnd,
      highEnd,
    })
  }

  return runways
}
