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

export const MSA_DEFAULT_RADIUS_NM = 25

// Rolling window for per-approach traffic averages.
export const DETECTION_HISTORY_WINDOW_MS = 5 * 60 * 1000

// Terrain hypsometric tint ramp (ft MSL → fill color), FAA-sectional-like.
// Elevations below the first stop (1000 ft) get no tint at all — see
// `hypsoStepExpression` in TerrainLayer.tsx, which uses fully-transparent
// as the step base rather than the first stop's color.
export const TERRAIN_HYPSO_STOPS: ReadonlyArray<readonly [number, string]> = [
  [1000, '#c5d59b'],
  [2000, '#e3dfa4'],
  [3000, '#f3d999'],
  [5000, '#e6bc80'],
  [7000, '#d49a64'],
  [9000, '#bd7c4f'],
  [12000, '#a05c3b'],
]
export const TERRAIN_FILL_OPACITY = 0.3
export const TERRAIN_CONTOUR_COLOR = '#8a6d4b'
export const CONTOUR_MAJOR_MIN_ZOOM = 9
export const CONTOUR_ALL_MIN_ZOOM = 11.5
export const CONTOUR_LABEL_MIN_ZOOM = 11
export const PEAK_LABEL_MIN_ZOOM = 8

// Profile panel (draggable/resizable altitude-profile overlay).
export const PROFILE_PANEL_MIN_W = 520
export const PROFILE_PANEL_MIN_H = 300
export const PROFILE_MARGIN_PX = 12
export const PROFILE_AIRCRAFT_UPDATE_MS = 1000

// Unit conversions shared across terrain labels, CIFP parsing, and geo math.
export const FEET_PER_METER = 3.28084
export const FEET_PER_NM = 6076.12

// TAA/MSA safe-altitude overlay styling.
export const SAFE_ALT_COLOR = '#94a3b8'
export const SAFE_ALT_FILL_OPACITY = 0.05
export const SAFE_ALT_LINE_WIDTH = 1.2
export const SAFE_ALT_LINE_OPACITY = 0.7
// Sector boundary lines are solid white for both TAA and MSA.
export const SAFE_ALT_LINE_COLOR = '#ffffff'

// FAA-plate-style localizer "feather" symbol, drawn along the final approach
// course of the selected LOC-based approach (ILS/LOC/LDA).
export const LOC_FEATHER_LENGTH_NM = 9
export const LOC_FEATHER_WIDTH_NM = 1.0
export const LOC_FEATHER_NOTCH_NM = 0.7
// Neutral slate so it reads on both dark and satellite basemaps without
// competing with the green approach-procedure palette.
export const LOC_FEATHER_COLOR = '#cbd5e1'

// MVA (Minimum Vectoring Altitude) sector overlay styling. Kept visually
// quiet (low fill opacity, thin lines) since sectors can be numerous/large
// and shouldn't compete with terrain tinting or procedure lines.
export const MVA_COLOR = '#e2e8f0'
export const MVA_FILL_OPACITY = 0.04
export const MVA_LINE_WIDTH = 1
export const MVA_LINE_OPACITY = 0.55
