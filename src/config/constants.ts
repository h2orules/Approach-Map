export const ADSBX_SEARCH_RADIUS_NM = 50

export const DEFAULT_POLL_INTERVAL_MS = 5_000
export const STALE_AIRCRAFT_THRESHOLD_S = 60

export const CROSS_TRACK_THRESHOLD_NM = 0.5
// Max angle between an aircraft's track and the procedure's local direction for
// it to count as "flying" that procedure. Rejects reciprocal-runway matches
// (e.g. a rwy-16 arrival sitting on the shared rwy-34 approach centerline).
// 45° covers the FAA's 30° ground-based navaid approach coverage plus a buffer
// for wind correction.
export const DIRECTION_TOLERANCE_DEG = 45
export const ALT_THRESHOLD_NEAR_FT = 250
export const ALT_THRESHOLD_FAR_FT = 500
export const NEAR_AIRPORT_DISTANCE_NM = 5

export const AUTO_HIDE_DELAY_MS = 5 * 60 * 1_000

export const EXTENDED_CENTERLINE_LENGTH_NM = 15

export const DEFAULT_MAP_CENTER = { longitude: -98.5, latitude: 39.5, zoom: 4 }

export const MAP_STYLES = {
  light: 'mapbox://styles/mapbox/light-v11',
  dark: 'mapbox://styles/mapbox/dark-v11',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
} as const

export const AIRAC_REFERENCE_DATE = '2024-01-25T00:00:00Z'
export const AIRAC_CYCLE_DAYS = 28

export const NASR_CYCLE_DAYS = 56
