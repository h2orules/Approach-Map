import type { Position } from 'geojson'

export interface MvaSector {
  /** Sector label as published on the chart, e.g. "SECTOR 1" or a bare number. */
  name: string
  /** Minimum vectoring/IFR altitude for the sector, in feet MSL. */
  minAltFt: number
  /** GeoJSON-style rings: [exterior, ...holes]. */
  polygon: Position[][]
}

// Parses an FAA AIXM 5.1 MVA/MIA sector chart (AIXMBasicMessage) into a flat
// list of sectors. Verified against a real ABQ MVA XML during this
// workstream's research; structure:
//
//   AIXMBasicMessage
//     hasMember
//       Airspace
//         timeSlice
//           AirspaceTimeSlice        (one per sector)
//             name                   -> sector label
//             geometryComponent
//               ...
//                 AirspaceVolume
//                   minimumLimit (uom="FT", MSL)  -> the MVA value
//                   horizontalProjection
//                     Surface
//                       patches
//                         PolygonPatch
//                           exterior -> LinearRing -> posList
//                           interior -> LinearRing -> posList  (0+, holes)
//
// `validTime` on the time slice is a placeholder (1980 baseline per FAA) and
// is ignored. Namespace prefixes (aixm:, gml:) vary by producer/version, so
// every lookup below uses getElementsByTagNameNS('*', localName) to match
// regardless of namespace.
export function parseMvaAixm(xmlText: string): MvaSector[] {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml')
  const sectors: MvaSector[] = []

  const timeSlices = Array.from(doc.getElementsByTagNameNS('*', 'AirspaceTimeSlice'))
  for (const slice of timeSlices) {
    const name = slice.getElementsByTagNameNS('*', 'name')[0]?.textContent?.trim() ?? ''

    const minimumLimitEl = slice.getElementsByTagNameNS('*', 'minimumLimit')[0]
    const minAltText = minimumLimitEl?.textContent?.trim()
    if (!minAltText) continue // no geometry/altitude — skip (e.g. a withdrawn sector)
    const minAltFt = parseInt(minAltText, 10)
    if (!Number.isFinite(minAltFt)) continue

    const exteriorEls = Array.from(slice.getElementsByTagNameNS('*', 'exterior'))
    if (exteriorEls.length === 0) continue // missing geometry — skip
    const exterior = parseRing(exteriorEls[0])
    if (!exterior || exterior.length < 3) continue

    const polygon: Position[][] = [exterior]

    for (const interiorEl of Array.from(slice.getElementsByTagNameNS('*', 'interior'))) {
      const hole = parseRing(interiorEl)
      if (hole && hole.length >= 3) polygon.push(hole)
    }

    sectors.push({ name, minAltFt, polygon })
  }

  return sectors
}

/** Reads the posList under a `gml:exterior`/`gml:interior` element into a ring of [lon, lat] pairs. */
function parseRing(boundaryEl: Element): Position[] | null {
  const posListEl = boundaryEl.getElementsByTagNameNS('*', 'posList')[0]
  const text = posListEl?.textContent?.trim()
  if (!text) return null

  const nums = text.split(/\s+/).map(Number)
  if (nums.length < 6 || nums.length % 2 !== 0 || nums.some((n) => !Number.isFinite(n))) return null

  const positions: Position[] = []
  for (let i = 0; i < nums.length; i += 2) {
    positions.push(orderAsLonLat(nums[i], nums[i + 1]))
  }
  return positions
}

// AIXM 5.1 gml:pos/posList coordinate order is documented as (lat, lon) for
// FAA's MVA feed, but this hasn't been re-verified against a live download in
// this sandbox (aeronav.faa.gov network access is blocked here), so order is
// determined defensively per pair rather than assumed globally: whichever of
// the two values has |v| > 90 must be the longitude (no CONUS/AK/HI MVA
// facility's latitude approaches 90), and the other is the latitude. Falls
// back to the documented (lat, lon) order when both values are <= 90 in
// magnitude (ambiguous — doesn't occur for any US facility in practice).
function orderAsLonLat(first: number, second: number): Position {
  const firstIsLon = Math.abs(first) > 90
  const secondIsLon = Math.abs(second) > 90
  if (firstIsLon && !secondIsLon) return [first, second]
  if (secondIsLon && !firstIsLon) return [second, first]
  return [second, first]
}
