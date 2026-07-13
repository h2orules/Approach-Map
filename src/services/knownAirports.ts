// A flat list of every known US airport position, warmed once from the static
// airport data and queried synchronously thereafter. The path engine uses this
// to give near-airport desensitization (terrain + traffic alerting) around ANY
// airport, not just the airports the user has made active — a KSEA arrival while
// only KPAE is active is still a normal approach into a known field.
//
// Shapes handled (see scripts/lib/airportIndex.ts + public/data/airports.json):
//   airport-index.json row: { lat, lon, elev, ... }  (all US airports w/ approaches)
//   airports.json    row:   { lat, lon, elevation, ... }  (legacy 89-airport set)
// Both normalize to { lat, lon, elevationFt }; rows missing coordinates are
// skipped, missing elevation defaults to 0.

export interface KnownAirport {
  lat: number
  lon: number
  elevationFt: number
}

const NM_PER_DEG_LAT = 60.04

let airports: KnownAirport[] = []
let warmed = false

/** Cheap planar distance in nm — good enough for a coarse proximity filter. */
function roughNmBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (aLat - bLat) * NM_PER_DEG_LAT
  const dLon = (aLon - bLon) * NM_PER_DEG_LAT * Math.cos((aLat * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLon * dLon)
}

/** Normalize one raw row (either shape) to a KnownAirport, or null if unusable. */
function normalizeRow(row: unknown): KnownAirport | null {
  if (!row || typeof row !== 'object') return null
  const r = row as { lat?: unknown; lon?: unknown; elev?: unknown; elevation?: unknown }
  if (typeof r.lat !== 'number' || typeof r.lon !== 'number') return null
  if (Number.isNaN(r.lat) || Number.isNaN(r.lon)) return null
  const elevRaw = typeof r.elev === 'number' ? r.elev : typeof r.elevation === 'number' ? r.elevation : 0
  const elevationFt = Number.isNaN(elevRaw) ? 0 : elevRaw
  return { lat: r.lat, lon: r.lon, elevationFt }
}

function ingest(json: unknown): void {
  if (!Array.isArray(json)) return
  const out: KnownAirport[] = []
  for (const row of json) {
    const norm = normalizeRow(row)
    if (norm) out.push(norm)
  }
  airports = out
}

/**
 * Warm the known-airports list from static data. Idempotent — after the first
 * call (or while one is in flight) subsequent calls are no-ops. Fetches the
 * all-US index first, falling back to the legacy 89-airport set on failure/404.
 * Returns immediately; the list populates asynchronously.
 */
export function warmKnownAirports(): void {
  if (warmed) return
  warmed = true
  void fetch('/data/airport-index.json')
    .then((res) => {
      if (!res.ok) throw new Error(`airport-index.json: HTTP ${res.status}`)
      return res.json()
    })
    .catch(() => fetch('/data/airports.json').then((res) => res.json()))
    .then((json) => ingest(json))
    .catch((err) => {
      // Both sources failed — leave the list empty (near-airport relief simply
      // won't apply). Reset so a later call can retry.
      warmed = false
      console.warn('knownAirports: failed to warm from static data:', err)
    })
}

/** The warmed known-airport list; empty until warmKnownAirports() resolves. */
export function getKnownAirports(): readonly KnownAirport[] {
  return airports
}

/** Known airports within `radiusNm` of a point (cheap equirectangular filter). */
export function airportsNear(lat: number, lon: number, radiusNm: number): KnownAirport[] {
  const out: KnownAirport[] = []
  for (const ap of airports) {
    if (roughNmBetween(lat, lon, ap.lat, ap.lon) <= radiusNm) out.push(ap)
  }
  return out
}

/** Test seam: clear the warmed state and cached list. */
export function _resetKnownAirports(): void {
  airports = []
  warmed = false
}
