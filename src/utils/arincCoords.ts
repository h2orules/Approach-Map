/**
 * ARINC 424 coordinate parsing.
 *
 * In the FAA CIFP, latitude/longitude fields carry a leading hemisphere letter:
 *   latitude  = N/S + DDMMSSSS  (e.g. "N47235217" → 47°23'52.17")
 *   longitude = E/W + DDDMMSSSS (e.g. "W122184162" → 122°18'41.62")
 *
 * `parseLatLon` strips the hemisphere letter and hands the remaining digits to
 * `parseDegMinSec`, so that helper sees 8 digits for latitude and 9 for
 * longitude — NOT 9/10. Getting these lengths wrong silently places every fix
 * near [0, 0]; see the regression tests.
 */

export function parseDegMinSec(digits: string, negative: boolean): number {
  if (!digits || digits.trim() === '') return 0
  const s = digits.trim()
  let deg: number, min: number, sec: number

  if (s.length === 8) {
    // Latitude: DDMMSSSS
    deg = parseInt(s.slice(0, 2))
    min = parseInt(s.slice(2, 4))
    sec = parseInt(s.slice(4, 8)) / 100
  } else if (s.length === 9) {
    // Longitude: DDDMMSSSS
    deg = parseInt(s.slice(0, 3))
    min = parseInt(s.slice(3, 5))
    sec = parseInt(s.slice(5, 9)) / 100
  } else {
    return 0
  }

  if (isNaN(deg) || isNaN(min) || isNaN(sec)) return NaN
  const dec = deg + min / 60 + sec / 3600
  return negative ? -dec : dec
}

export function parseLatLon(
  latStr: string,
  lonStr: string,
): { lat: number; lon: number } | null {
  if (!latStr || !lonStr) return null
  const latRaw = latStr.trim()
  const lonRaw = lonStr.trim()
  if (!latRaw || !lonRaw) return null

  const latNeg = latRaw[0] === 'S'
  const lonNeg = lonRaw[0] === 'W'
  const lat = parseDegMinSec(latRaw.slice(1), latNeg)
  const lon = parseDegMinSec(lonRaw.slice(1), lonNeg)

  if (isNaN(lat) || isNaN(lon) || (lat === 0 && lon === 0)) return null
  return { lat, lon }
}
