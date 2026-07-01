export const ADSBX_SEARCH_RADIUS_NM = 50

export const DEFAULT_POLL_INTERVAL_MS = 5_000
export const STALE_AIRCRAFT_THRESHOLD_S = 60

// SID/STAR cross-track tolerance: wider to catch traffic still navigating to the route.
export const CROSS_TRACK_THRESHOLD_NM = 0.5
// Approach cross-track tolerance: tighter so parallel runways are disambiguated by
// lateral position. At KSEA 16L/16C spacing is ~0.13 nm; 0.25 nm keeps a comfortable
// margin while still being well inside the closest pair.
export const CROSS_TRACK_APPROACH_NM = 0.25
// Max angle between an aircraft's track and the procedure's local direction for
// it to count as "flying" that procedure. Rejects reciprocal-runway matches
// (e.g. a rwy-16 arrival sitting on the shared rwy-34 approach centerline).
// 45° covers the FAA's 30° ground-based navaid approach coverage plus a buffer
// for wind correction.
export const DIRECTION_TOLERANCE_DEG = 45
export const ALT_THRESHOLD_NEAR_FT = 250
export const ALT_THRESHOLD_FAR_FT = 500
// Tight altitude tolerance used when both bracketing waypoints have exact (AT or
// BETWEEN) altitude constraints, or when on a precision GS segment.  Linear
// interpolation / GS geometry is accurate to ~50 ft in those cases, so 100 ft
// gives a comfortable margin without admitting adjacent-runway traffic.
export const ALT_THRESHOLD_CONSTRAINED_FT = 100
export const NEAR_AIRPORT_DISTANCE_NM = 5
// 3° glide slope: sin(3°) × 6076 ft/nm ≈ 318 ft/nm.  Used to project expected
// altitude on the GS segment of precision approaches.
export const GS_FEET_PER_NM = 318

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
