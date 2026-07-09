export const ADSBX_SEARCH_RADIUS_NM = 50
// ADS-B Exchange rejects radius queries beyond 250 nm, so a poll cluster's
// covering circle (member spread + per-airport radius) is clamped to this.
export const POLL_CLUSTER_MAX_RADIUS_NM = 250

// ── Multi-airport limits (Phase 4+) ─────────────────────────────────────────
// Several airports can be active at once (their procedures/runways coexist on
// the map). MAX_ACTIVE_AIRPORTS is the hard cap enforced by
// useAirportStore.addAirport (returns 'capped' past it). MAX_ACTIVE_AIRPORTS_SOFT
// is the clutter/saturation threshold the UI uses (Phase 5) to prompt the user
// to reduce the count — it does not block adds.
export const MAX_ACTIVE_AIRPORTS = 10
export const MAX_ACTIVE_AIRPORTS_SOFT = 5

// ── Render budgets (Phase 7 perf review) ────────────────────────────────────
// Each visible procedure costs ~5 Mapbox GL layers (line, casing, hit-target,
// direction arrows, etc. — see ProcedureLayer.tsx), so a busy multi-airport
// session can add up fast. Past this many simultaneously-visible procedure
// lines, AppMap shows a small dismissible hint (reusing the AirportList
// clutter-hint pattern) telling the user to hide procedures or collapse
// airport sections — it never silently culls a line.
export const MAX_RENDERED_PROCEDURE_LINES = 150
// WaypointMarkers renders one DOM Marker per on-screen fix, with an O(n²)-ish
// label-collision placement pass (each candidate label position is scored
// against every other placed icon/label rect). Past this many on-screen
// symbols, WaypointMarkers degrades to icon-only glyphs (skips the label
// placement pass entirely for the overflow, dropping name/altitude/speed
// text) so the collision loop itself gets cheaper, not just the DOM output.
export const MAX_ONSCREEN_WAYPOINT_SYMBOLS = 250

export const DEFAULT_POLL_INTERVAL_MS = 5_000
export const STALE_AIRCRAFT_THRESHOLD_S = 60

// Max angle between an aircraft's track and the procedure's local direction for
// it to count as "flying" that procedure. Rejects reciprocal-runway matches
// (e.g. a rwy-16 arrival sitting on the shared rwy-34 approach centerline).
// 45° covers the FAA's 30° ground-based navaid approach coverage plus a buffer
// for wind correction. Also used by flownSegment/activeSegments.
export const DIRECTION_TOLERANCE_DEG = 45
export const NEAR_AIRPORT_DISTANCE_NM = 5
// 3° glide slope: sin(3°) × 6076 ft/nm ≈ 318 ft/nm.  Used to project expected
// altitude on the GS segment of precision approaches.
export const GS_FEET_PER_NM = 318

// ── Time-confirmed detection machine (src/geo/detectionMachine.ts) ──────────
// Loose per-poll "candidate" gates admit noisy/established traffic; a track only
// becomes visible after it sustains matches over time (hysteresis). Confirmed
// tracks are re-evaluated with widened gates so a level-off or transient jitter
// doesn't shed the lock — only sustained lateral departure does.
//
// KSEA 16L/16C centerlines are ~0.13 nm apart, so the candidate approach gate
// (0.35 nm) admits the neighbor; min-cross-track assignment plus the reassign
// streak resolve which runway a plane is actually on. A perpendicular crosser
// can't accumulate the required matches within the direction gate in 10 s.
export const DETECT_CANDIDATE_XT_APPROACH_NM = 0.35
export const DETECT_CANDIDATE_XT_SIDSTAR_NM = 0.8
export const DETECT_CANDIDATE_DIR_DEG = 45
export const DETECT_CANDIDATE_ALT_CONSTRAINED_FT = 200
export const DETECT_CANDIDATE_ALT_NEAR_FT = 400
export const DETECT_CANDIDATE_ALT_FAR_FT = 800
export const DETECT_CONFIRMED_XT_APPROACH_NM = 0.6
export const DETECT_CONFIRMED_XT_SIDSTAR_NM = 1.5
export const DETECT_CONFIRMED_DIR_DEG = 60
export const DETECT_CONFIRM_MIN_MATCHES = 3
export const DETECT_CONFIRM_MIN_DURATION_MS = 10_000
// SID/STAR confirmation additionally requires this much net along-track
// progress between the first and confirming match. Time-based hysteresis alone
// can't reject VFR traffic circling near a leg: one standard-rate lap keeps the
// track inside the direction gate for ~30 s (enough matches over enough time)
// while covering almost no distance along the line. A real SID/STAR flyer
// advances continuously; 1.5 nm delays a 200 kt confirmation by ~15 s and holds
// out a 90 kt trainer's aligned arc (~0.7 nm per lap). Approaches are exempt —
// they're already gated by glideslope/altitude and the MAP rules, and short
// finals may not have 1.5 nm of line left to cover.
export const DETECT_CONFIRM_MIN_PROGRESS_NM = 1.5
export const DETECT_CANDIDATE_TTL_MS = 15_000
export const DETECT_CONFIRMED_TTL_MS = 30_000
export const DETECT_REASSIGN_CLOSER_STREAK = 3
// Extra padding (nm) added around a procedure's waypoint bounding box before it
// gates whether an aircraft can start a NEW detection track. Combined with
// NEAR_AIRPORT_DISTANCE_NM (5) this yields a 6 nm pad — comfortably wider than
// the widest cross-track gate (DETECT_CONFIRMED_XT_SIDSTAR_NM = 1.5) so the
// prefilter never drops an aircraft that could actually match. See
// src/geo/procedureBbox.ts.
export const DETECT_BBOX_PAD_NM = 1
// US VFR squawk. Aircraft squawking this are never on an IFR clearance, so the
// detection machine ignores them entirely (a 1200 squawker shooting a practice
// approach isn't "using" the procedure). VFR flight-following traffic carries a
// discrete code and remains detectable — geometry gates must handle it.
export const VFR_SQUAWK = '1200'

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

// TAA/MSA safe-altitude overlay styling. The neutral slate fill reads on both
// basemaps, but the boundary lines must invert with the map theme (a white
// line vanishes on the light basemap, a dark one on the dark basemap).
export const SAFE_ALT_COLOR = '#94a3b8'
export const SAFE_ALT_FILL_OPACITY = 0.05
export const SAFE_ALT_LINE_WIDTH = 1.2
export const SAFE_ALT_LINE_OPACITY = 0.7
export const SAFE_ALT_LINE_COLOR = '#ffffff' // on dark/satellite basemaps
export const SAFE_ALT_LINE_COLOR_LIGHT = '#1e293b' // on the light basemap

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
// and shouldn't compete with terrain tinting or procedure lines. The near-white
// fill+line must invert with the map theme to stay visible on the light basemap.
export const MVA_COLOR = '#e2e8f0' // on dark/satellite basemaps
export const MVA_COLOR_LIGHT = '#334155' // on the light basemap
export const MVA_FILL_OPACITY = 0.04
export const MVA_LINE_WIDTH = 1
export const MVA_LINE_OPACITY = 0.55

// Route enrichment (origin/destination lookup) cache behavior — see src/api/routes.ts.
// Confirmed-unknown callsigns are negative-cached for this long before re-querying.
export const ROUTE_NEGATIVE_TTL_MS = 10 * 60 * 1000
// Transient provider failures (network/5xx) back off exponentially per callsign.
export const ROUTE_RETRY_BASE_MS = 30_000
export const ROUTE_RETRY_MAX_MS = 5 * 60 * 1000

// Airspace (Class B/C/D/E) overlay, styled after FAA VFR sectional charts:
// Class B & D use blue linework, Class C & E use magenta. B/C are solid,
// D and Class-E-surface are dashed. The Class-E transition areas (700ft/1200ft
// AGL floors) cover huge swaths of the chart, so they're drawn as a faint
// boundary line ONLY — filling their interiors (as a paper sectional's soft
// vignette can't be reproduced here) washes the whole basemap magenta.
// Source: FAA AIS "Class_Airspace" ArcGIS FeatureServer (see
// src/api/faaAirspace.ts / the /api/faa-airspace dev proxy in vite.config.ts).
export const AIRSPACE_BLUE = '#5b8def'    // Class B (solid) and Class D (dashed)
export const AIRSPACE_MAGENTA = '#d15fc4' // Class C (solid) and Class E (dashed/boundary)
export const AIRSPACE_FILL_OPACITY = 0.05 // B / C / D / E-surface only (never the E transition areas)
export const AIRSPACE_LINE_OPACITY = 0.85
export const AIRSPACE_E_TRANS_LINE_OPACITY = 0.4 // faint boundary for the 700/1200ft AGL Class-E areas
export const AIRSPACE_SOLID_LINE_WIDTH = 1.7 // Class B / C
export const AIRSPACE_DASHED_LINE_WIDTH = 1.4 // Class D / E surface
// Half-degree padded box fetched around the selected airport (≈ ±60 nm N/S,
// widened E/W by 1/cos(lat) at query time so the box stays roughly square).
export const AIRSPACE_FETCH_HALF_DEG = 1.0
// Airspace changes on the 56-day chart cycle; 28 days is a conservative
// "recheck occasionally" cache window (not tied to a published revision date).
export const AIRSPACE_CACHE_MAX_AGE_MS = 28 * 24 * 60 * 60 * 1000
