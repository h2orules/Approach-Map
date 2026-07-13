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
// Holds (HILPT course reversals, missed-approach racetracks) are matched
// against the drawn racetrack polyline, not the straight representative path —
// otherwise a holding aircraft only matches on the inbound leg (which aligns
// with the final course) and drops out through the outbound leg and both turns,
// flickering ~once per lap. The tolerances are deliberately generous: the drawn
// racetrack uses a 0.85 nm turn radius, but a real hold's size varies with speed
// (turn radius ~1.1 nm at 200 kt), leg type (timing vs distance), and wind, so a
// flown hold sits up to ~2 nm off the drawn one. A holding aircraft is
// continuously turning, so the direction gate is wide too — position (the 2 nm
// cross-track keeps matches inside the hold's vicinity) plus the confirm/TTL
// hysteresis, not instantaneous heading, is what rejects transiting traffic.
export const HOLD_MATCH_XT_NM = 2.0
export const HOLD_MATCH_DIR_DEG = 75
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

// ── Tracklog ────────────────────────────────────────────────────────────────
export const TRACKLOG_MAX_POINTS = 720 // ~1h at 5s polls
// A gap between consecutive points longer than this breaks the drawn trail
// (coverage dropout, stale target) instead of connecting across it.
export const TRACKLOG_GAP_BREAK_MS = 30_000
// Max cross-track distance (nm) from the profile's transition line for a
// tracklog point to count as "near the approach" — see src/geo/profileTrail.ts.
export const PROFILE_TRACK_XT_MAX_NM = 3

// ── Path prediction ─────────────────────────────────────────────────────────
export const PREDICT_STEP_S = 5
export const PREDICT_MAX_S = 300
// Observed turn rates below the min are treated as straight flight; above the
// max as noise (clamped) — standard rate is 3°/s.
export const TURN_RATE_MIN_DPS = 0.5
export const TURN_RATE_MAX_DPS = 4.0
// A detected turn is held at its observed rate for HOLD_S seconds of the
// prediction, then decays linearly to straight flight by DECAY_END_S.
export const PREDICT_TURN_HOLD_S = 15
export const PREDICT_TURN_DECAY_END_S = 45
// Within this many feet of a constraint/profile altitude, the prediction
// captures onto the profile instead of extrapolating the raw baro rate.
export const PREDICT_PROFILE_CAPTURE_FT = 150
export const PREDICT_MIN_DESCENT_FPM = 500
export const PREDICTION_MINUTES_OPTIONS = [1, 2, 3, 5] as const

// ── Hold-entry prediction ───────────────────────────────────────────────────
export const HOLD_ENTRY_BRG_DEG = 10
export const HOLD_ENTRY_MAX_ETA_S = 180
export const HOLD_ENTRY_PASS_NM = 1.0
export const HOLD_ENTRY_ALT_TOL_FT = 2000
export const HOLD_ENTRY_CLEAR_POLLS = 3
// AIM 5-3-8 teardrop entry: outbound offset ~30° from the reciprocal of the
// inbound course, on the holding side.
export const HOLD_ENTRY_TEARDROP_OFFSET_DEG = 30
// Mapbox line-dasharray for the predicted entry path (dot-dash).
export const HOLD_ENTRY_DASH: number[] = [0.01, 2, 2.5, 2]

// ── Traffic conflicts ───────────────────────────────────────────────────────
// The TCAS TA/RA sensitivity-level table itself lives in src/geo/tcasTables.ts;
// these are the CPA-projection horizon, the pair prefilter, and the
// ATC-radar-style separation-alert thresholds.
export const CONFLICT_HORIZON_S = 180
export const CONFLICT_PREFILTER_NM = 30
export const CONFLICT_PREFILTER_DALT_FT = 6000
export const RADAR_ALERT_SEP_NM = 2.0
export const RADAR_ALERT_DALT_FT = 1200
export const RADAR_ALERT_HORIZON_S = 45
export const RADAR_WARN_SEP_NM = 1.3
export const RADAR_WARN_DALT_FT = 1200
export const RADAR_WARN_HORIZON_S = 25
// RA escape-maneuver model: assumed vertical rate after a pilot-response
// delay (TCAS II assumes 1500 fpm within 5 s for an initial RA).
export const RA_ESCAPE_FPM = 1500
export const RA_RESPONSE_DELAY_S = 5
// Suppress traffic alerts close to the ground near a known airport, where
// converging final/pattern traffic is normal (TCAS inhibits low-AGL alerts too).
// ForeFlight-style near-airport desensitization: pattern-altitude traffic
// (parallel/in-trail arrivals, low pattern work) shouldn't alert.
export const TRAFFIC_SUPPRESS_AGL_FT = 1000
export const TRAFFIC_SUPPRESS_AIRPORT_NM = 3
// Radar-tier alerts require actual convergence into the separation window: a
// qualifying sample must close at least this much versus the t=0 separation
// (or the pair must enter the window from outside it). Stable formation /
// simultaneous-parallel-approach pairs sitting at constant separation already
// inside the window must NOT latch a radar alert — ForeFlight's published
// semantics are "path WILL intersect the threshold within 45 s", i.e. converging.
export const RADAR_MIN_CLOSURE_NM = 0.1
// Formation / duplicate-track suppression: a pair sustaining near-identical
// position, altitude, track, and speed is either intentional formation flying
// or two ADS-B/TIS-B tracks of the same airframe (duplicate reception) — not a
// conflict. Matched velocity means zero closure, so nothing is lost by
// skipping the pair entirely (both the TCAS and radar tiers).
export const FORMATION_SUPPRESS_NM = 0.5
export const FORMATION_SUPPRESS_DALT_FT = 400
export const FORMATION_SUPPRESS_TRK_DEG = 10
export const FORMATION_SUPPRESS_GS_KT = 10
// TIS-B shadow suppression: a TIS-B pseudo-track (hex starting '~') can be a
// rebroadcast of a radar trackfile up to ~60 s stale, which at typical GA
// speeds trails 2+ nm behind the live position — well outside
// FORMATION_SUPPRESS_NM. A co-moving pair where at least one side is TIS-B is
// therefore checked against wider tolerances so a stale shadow of the same
// (or a nearby) airframe isn't mistaken for a converging target.
export const TISB_SHADOW_NM = 2.5
export const TISB_SHADOW_DALT_FT = 500
export const TISB_SHADOW_TRK_DEG = 15
export const TISB_SHADOW_GS_KT = 20

// ── Terrain alerting ────────────────────────────────────────────────────────
export const TERRAIN_TILE_ZOOM = 9
export const TERRAIN_TILE_CACHE_MAX = 48
export const TERRAIN_ALERT_CLEARANCE_FT = 1000 // ForeFlight Hazard Advisor amber
export const TERRAIN_WARN_CLEARANCE_FT = 100 // ForeFlight red
// An MVA sector already carries ~1000 ft of obstacle buffer, so warn only when
// the aircraft is meaningfully below the sector value, not merely under it.
export const TERRAIN_MVA_WARN_BELOW_FT = 900
// Within this many feet of an approach's expected profile altitude, terrain
// alerts are suppressed (a normal approach descends toward terrain by design).
export const TERRAIN_ONAPPROACH_TOL_FT = 400
// Skip the first seconds of the scan ahead of the aircraft — terrain there is
// effectively underneath it, and this kills spurious own-runway alerts.
export const TERRAIN_SCAN_SKIP_FIRST_S = 10
// Terrain look-ahead horizon. Deliberately much shorter than the 180 s traffic
// horizon (CONFLICT_HORIZON_S): extrapolating baro rate 3 minutes ahead drives
// every ordinary descending IFR arrival "through" distant MVA floors it will
// actually level off above. Real MSAW projects far less — roughly the next
// radar scan or two — so 60 s already errs on the side of caution.
export const TERRAIN_SCAN_HORIZON_S = 60
// MSAW-style approach/departure exclusion volume around ANY known airport: a
// predicted sample within TERRAIN_AIRPORT_EXCLUDE_NM of a known airport and
// below its field elevation + TERRAIN_AIRPORT_EXCLUDE_FT is a normal
// arrival/departure, not a terrain conflict — excluded regardless of whether the
// aircraft has a confirmed approach assignment (FAA MSAW carves out approach
// corridors this way).
export const TERRAIN_AIRPORT_EXCLUDE_NM = 4
export const TERRAIN_AIRPORT_EXCLUDE_FT = 1500
// TAWS-style landing-configuration inhibit: an aircraft slow AND low above the
// ACTUAL ground (not a charted field) is landing or departing at some strip,
// charted or not — this covers airports absent from the index (no MSAW
// exclusion volume above), e.g. private/grass strips. Below typical GA cruise
// speed; jets land at charted airports already covered by
// TERRAIN_AIRPORT_EXCLUDE_NM/_FT above.
export const TERRAIN_LANDING_GS_KT = 95
export const TERRAIN_LANDING_AGL_FT = 700

// ── Range rings / path colors ───────────────────────────────────────────────
// Ring radii bucketed by map zoom: the first bucket whose minZoom the current
// zoom meets wins.
export const RING_ZOOM_BUCKETS: { minZoom: number; radiiNm: [number, number, number] }[] = [
  { minZoom: 11, radiiNm: [1, 3, 6] },
  { minZoom: 9.5, radiiNm: [2, 5, 10] },
  { minZoom: 8, radiiNm: [5, 10, 15] },
  { minZoom: -Infinity, radiiNm: [12, 25, 50] },
]
export const PREDICTION_LINE_COLOR = '#ffffff'
export const ALERT_AMBER = '#fbbf24' // distinct from AIRCRAFT_COLOR #f59e0b (src/utils/colorScheme.ts)
export const WARNING_RED = '#ef4444'
