# Approach Map

A localhost web app that visualizes live ADS-B aircraft positions relative to published FAA instrument procedures (SIDs, STARs, Approaches) at US airports. Think TRACON radar display with modern styling.

## Stack

- **React 18 + TypeScript + Vite** — no Next.js, plain Vite SPA
- **react-map-gl v7 + mapbox-gl v2** — v7 to avoid Mapbox v3 license complexity
- **Zustand** for state (8 stores: aircraft, airport, map, pane, path, procedure, selection, settings); **TanStack Query v5** for the clustered ADS-B poll
- **@turf/turf v6** for geo math (cross-track distance, dead-reckoning, bearings)
- **Fuse.js** for fuzzy airport search over `public/data/airport-index.json` (all US airports with published approaches), falling back to the bundled `public/data/airports.json` (89 airports) if the index hasn't been built yet
- **fflate** for ZIP extraction (CIFP download is a ZIP, not gzip)
- **clsx** for conditional classNames

## Required environment variables

Copy `.env.example` to `.env.local` and fill in:

- `VITE_MAPBOX_TOKEN` — Mapbox public token (account.mapbox.com, scopes: styles:read, tiles:read). Public by design; inlined into the client bundle.
- `ADSBX_API_KEY` — ADS-B Exchange supporter-tier API key. Deliberately **not** `VITE_`-prefixed: it must never enter the client bundle. In dev the Vite proxy attaches it as `X-RapidAPI-Key` server-side (`vite.config.ts`); in production it's a Static Web App application setting read by the Functions proxy (`api/src/functions/proxy.ts`).

The dATIS (atis.info), adsbdb route-lookup, and FAA (CIFP/d-TPP) APIs are keyless — no config needed.

## Dev

```sh
npm run dev              # Vite dev server on :5173 with dev-proxies (see below)
npm run test             # Vitest (~513 unit tests) — watch mode
npm run test:ui          # Vitest UI
npm run build            # tsc -b && vite build (production)
npm run preview          # Preview a production build
npm run build-static-data # Regenerate public/data/airports.json + runways.json (legacy 89-airport set)
npm run build-airport-index # Regenerate public/data/airport-index.json + airports/{key}.json (all US airports w/ approaches; needs unrestricted network egress — see Data sources)
npm run validate-static-data # Schema/cross-check the built index + shards; add --live to also spot-check upstream APIs
```

There is no ESLint/Prettier config in the repo; match the surrounding code style
(2-space indent, single quotes, no semicolons, CSS Modules per component).

## Deployment

Deploys to **Azure Static Web Apps (Free tier)** — static SPA + the eight
`/api/*` proxy routes as SWA-managed Azure Functions (`api/` folder, Node 20).
GitHub Actions deploys on push to `main` and creates PR preview environments
(`.github/workflows/azure-static-web-apps.yml`); `.github/workflows/ci.yml`
runs typecheck + tests + build on every PR and main push and is the required
status check for merging. Azure resources are defined in `infra/main.bicep`,
provisioned via `scripts/azure/*.sh`. Shared VS Code debug/test configs are in
`.vscode/`. See `DEPLOYMENT.md` for the full setup (secrets, custom domain,
CI/branch protection, local debugging, limits, troubleshooting).

## Directory layout

```
src/
  api/           Thin fetch wrappers, one per upstream (adsbx, datis, faaAirspace, routes=adsb.lol+adsbdb)
  components/    React UI, grouped by area (airport, controls, layout, map, procedures, profile)
                 Each component pairs with a co-located *.module.css
                 airport/  AirportSearch, AirportList, AirportSection — per-airport sidebar sections
                 layout/   TopBar, Sidebar, SidebarHeader, ActiveProceduresOverlay, CifpStatusBanner
  config/        constants.ts — all tunable thresholds live here
  geo/           Pure geo functions + __tests__ (detection, segments, centerline, shapes, interpolation, clusterAirports,
                 prediction, holdEntry, conflicts, terrainScan, tcasTables, rangeRings)
  hooks/         React glue: polling, interpolation loop, detection, path prediction/alerting, enrichment, dATIS,
                 AIRAC lifecycle, airport search, pane mode
  services/      cifpCache.ts (per-airport IndexedDB cache) + db.ts (injectable KVStore seam), mvaData.ts, airspaceData.ts,
                 trackLog.ts (non-reactive per-hex tracklog ring buffers), terrainElevation.ts (Mapbox terrain-rgb DEM cache)
  store/         Zustand stores (aircraft, airport, map, pane, path, procedure, selection, settings)
  types/         Shared TS types (aircraft, airport, procedure, path)
  utils/         Pure helpers + __tests__ (airac, arincCoords, altitude*, airlines, aircraftTypes, colorScheme, formatters, mapImages)
  workers/       cifpParser.worker.ts — parses ARINC 424 off the main thread; cifpGrouping.ts shares grouping/enumeration logic with scripts/buildAirportIndex.ts
api/             Azure Functions proxy for production (mirrors the vite.config.ts dev proxies)
infra/           main.bicep — Azure resource definitions (Static Web App)
scripts/         buildStaticData.ts (legacy 89-airport public/data/*.json), buildAirportIndex.ts (all-US index + shards), validateStaticData.ts
scripts/lib/     Shared join/validate helpers used by the two build scripts above (csv, cache, runways, airportIndex, validate)
scripts/azure/   az-cli scripts: provision, secrets, custom domain, teardown
public/data/     airports.json (89 airports), runways.json (86 airports) — legacy, always bundled
                 airport-index.json + airports/{key}.json — generated by build-airport-index (all US airports
                 with published approaches); not gitignored, committed once produced, but require unrestricted
                 network egress to build — see Data sources
```

App composition: `App.tsx` → `TopBar` + `Sidebar` (`SidebarHeader` collapse
control → `AirportList` of per-airport `AirportSection`s, each with its own
procedure groups → `SettingsPanel`) + `AppMap`. `AppMap` mounts all the map
layers and wires up every hook.

## Key architecture decisions

**Aircraft at 60fps without React re-renders.** `src/hooks/useAircraftInterpolation.ts` runs a `requestAnimationFrame` loop, dead-reckons positions via `turf.destination()`, and calls `mapboxSource.setData()` directly — bypassing React entirely. React only re-renders the aircraft layer when the aircraft _set_ changes, which `useAircraftStore` signals via a `revision` counter bumped only on poll (not on interpolation).

**CIFP uses AIRAC-cycle-aware IndexedDB caching.** The FAA CIFP file (~9MB zip) follows the 28-day AIRAC cycle. `src/services/cifpCache.ts` downloads, parses (in `src/workers/cifpParser.worker.ts`), and stores in IndexedDB keyed by cycle effective date **and** `PARSER_VERSION` (currently 23 — bump it whenever parser logic changes so stale/buggy parses are discarded). `src/hooks/useAiracCycle.ts` drives the lifecycle: a `setTimeout` fires at the exact next-cycle boundary to refresh, and a `visibilitychange` listener handles tabs backgrounded across a boundary. Reference: `src/utils/airac.ts` for cycle math. Storage is per-airport, not one monolithic blob: the worker writes `airport:{key}` records plus meta keys (`effectiveDate`, `parserVersion`, `index`), and `useCifpStore` warms airports lazily via `ensureAirport(key)` on selection so cold-start memory stays bounded regardless of how many US airports are indexed. An injectable `dbGet`/`dbPut` seam (`src/services/db.ts`, `KVStore`) lets tests fake IndexedDB instead of hitting a real one.

CIFP file facts (verified against live FAA data, June 2026):

- Zip URL is `CIFP_YYMMDD.zip` (6-digit date, e.g. `CIFP_260611.zip`), AIRAC reference `2024-01-25`.
- The ARINC 424 data file inside is named `FAACIFP18` (no extension), alongside PDFs/xlsx.
- Airport-section records (`P`): section code at col 5, ICAO at cols 7–10, **subsection at col 13** (`D`=SID, `E`=STAR, `F`=Approach, `C`=terminal waypoint). Enroute (`E`) and navaid (`D`) records put subsection at col 6 instead.
- Col 39 is the **continuation record number**: `0`/`1` = primary, anything higher is a continuation reusing the primary's sequence number with blank leg fields (RNAV FAF legs carry an SBAS FAS-data `W` continuation). The parser must skip continuations or they overwrite the primary leg — this once erased every RNAV FAF's role/altitude (KAWO R34 YAYKU).
- SID/STAR/approach legs carry NO embedded lat/lon — fix coordinates are looked up by name from terminal-waypoint (`PC`) and enroute (`EA`) records (lat at cols 33–41, lon 42–51). See `src/utils/arincCoords.ts`.
- Legs also carry altitude/speed constraints, DME (Rho, cols 67–70), a recommended navaid (cols 51–54), and description codes (flyover, etc.) that the parser turns into renderable `WaypointSymbol`s.
- Waypoint-description char 4 (col 43) is the fix role: `A`/`C`/`D`=IAF, `B`/`I`=IF, `F`=FAF, `M`=MAP, `H`=hold. Leg courses (cols 71–74) are **magnetic** — convert with the airport magvar (PA record) via `magneticToTrue()` before drawing geometry, but keep magnetic for display so labels match charts. For `PI` (procedure-turn) legs the course field holds the 45° _barb_ course (outbound = barb ∓45° by turn direction) and the leg-length field holds the remain-within distance; a transition is NoPT when the approach has a PI/HF leg in a _different_ transition. A hold-in-lieu-of-PT (HILPT) is coded as its own **single-leg HF transition** named after the fix (KAWO R34 "SAVOY") — the parser must keep 1-leg transitions or the racetrack, NoPT inference, and `Procedure.holdInLieu` all vanish. The CIFP carries only the HF leg's own crossing constraint (e.g. ≥2000); the charted **maximum** holding altitude (the plate's 6000) exists only in NASR HPF data, not the CIFP. Cols 103–106 carry the leg VDA (signed hundredths of a degree; feeds `gpaDeg`/`gsSource` for approaches without a path-point or ILS GS record). Pure parsing/derivation lives in `src/workers/cifpParseCore.ts`, unit-tested against raw KAWO LOC 34 fixture lines.
- A DME-arc leg (`AF` path/terminator) is flown at a constant DME radius around its recommended navaid, not straight to the fix: the parser resolves that navaid's position into `ProcedureLeg.arc` and the feature builder replaces the leg's straight chord with a sampled constant-radius arc (`dmeArc` in `src/geo/procedureShapes.ts`, swept the short way in the leg's turn direction). Without this the arc renders as chords that cut inside the fixes (KPAE VOR-A around the PAE VOR is the reference case). `AF` is in `segmentCourseLabels`' skip set so no misleading chord course is labeled on the curve.
- Each procedure has multiple transitions (runway + enroute) that restart sequence numbers; the parser keys waypoints by transition to avoid collisions and draws one line per transition.
- The CIFP has **no marker-beacon records** (0 subsection-`M`). The only detectable marker is a Locator Outer Marker (LOM): an approach FAF collocated (≤0.5 nm) with an NDB. The parser captures airport-terminal NDBs (`P/N`, subsection at col 6 like enroute) as well as enroute NDBs (`DB`), and tags such FAFs via `WaypointSymbol.marker`/`markerLocator`. Rendered as an FAA lens/NDB glyph under the fix (map) and a dotted ground-to-top cone (profile). KAWO LOC 34 (FAF WATON over the AWO NDB) is the reference case. RNAV/RNP approaches (`R`/`H` idents) are excluded — their plates never chart markers, and an RNAV FAF beside a locator (KAWO R34 YAYKU next to the AW NDB) is not a LOM.

**Multi-airport state.** Several airports can be active at once — their procedures, runways, and detection all coexist. `useAirportStore.activeAirports` is an ordered array (index 0 is the camera anchor / `selectedAirport` mirror) with `addAirport`/`removeAirport` actions; a soft clutter prompt fires at `MAX_ACTIVE_AIRPORTS_SOFT` (5) and a hard cap at `MAX_ACTIVE_AIRPORTS` (10). `useProcedureStore.mergeAirportProcedures(key, procs)` / `removeAirportProcedures(key)` replaced a wholesale `setProcedures()` reset — they splice only that airport's `${key}-`-prefixed procedure ids and preserve every other airport's `userToggles`/`autoVisible`/`detectedHexes`/`aircraftAssignments`/`detectionHistory`; this was the load-bearing refactor that made N-airport coexistence safe. Procedure colors use a 2D scheme (`src/utils/colorScheme.ts`): a hue family per airport (5 pure trios, `assignColor(key, type, existing)`, no global mutable counters — slot 0 reproduces the original single-airport cyan/indigo/emerald palette exactly) and a shade cycled per procedure within that family. Detection is per-airport too: `useProcedureDetection.ts` looks up each procedure's `AirportContext` (lat/lon/elevation) from a `Map<key, AirportContext>` keyed by `proc.icao` instead of a singleton (so a second airport's altitude gating can't silently read the wrong field's elevation), and a padded bounding-box prefilter (`DETECT_BBOX_PAD_NM`) skips cross-track math for procedures nowhere near a given aircraft before the detection machine runs. `useDatis` runs one 10-minute timer per active airport into `atisByIcao`. `useRunways` falls back per airport through a shard → legacy `runways.json` → CIFP-synthesized-geometry chain (`getRunwayInfoForAirport`) so no active airport ever renders runway-less. **ADS-B polling is clustered**, not one query per airport: `src/geo/clusterAirports.ts` greedily merges airports whose covering circle (centroid + max member distance + per-airport search radius) stays within `POLL_CLUSTER_MAX_RADIUS_NM`, `useAircraftPoll` runs one TanStack `useQueries` fetch per cluster, and `mergeAircraftResponses` (`src/api/adsbx.ts`) dedupes overlap (freshest `seen` wins) — a metro area like KJFK+KLGA+KEWR costs one ADSBX request, not three.

**Collapsible pane + mobile bottom sheet.** `usePaneStore` is a plain (non-domain) Zustand store: `collapsed` (desktop/tablet rail-collapse, persisted) and `sheetOpen` (phone bottom-sheet expanded vs. peeking, session-only). `deriveMode(widthPx)` is a pure function (no DOM read) mapping viewport width to `'push'` (desktop — the sidebar reflows `.mapArea` on collapse, and `AppMap` exposes `resize()` fired on the rail's `transitionend` since mapbox-gl doesn't notice a reflowed container on its own) or `'overlay'` (phones ≤640px, `PANE_OVERLAY_BREAKPOINT_PX` — the sidebar becomes a fixed-position bottom sheet with a 44px handle bar, and the map canvas never resizes). `Cmd/Ctrl+B` toggles the desktop collapse from anywhere outside a text input.

**Anisotropic (per-axis) zoom.** The map can be zoomed further along one screen axis than the other (e.g. zoom in horizontally to separate parallel-runway traffic while staying zoomed out vertically to see the whole approach). Mapbox has one zoom, so `useMapStore.axisRatio` (zoomY − zoomX, session-only, clamped ±`AXIS_ZOOM_MAX_RATIO`) is realized by `AxisStretchFrame`: the mapbox zoom is always the LESS zoomed axis and the frame is laid out smaller along the more-zoomed axis, then CSS-scaled up to fill the viewport (origin top-left, so layout↔visual conversion is a pure divide — pure math in `src/utils/axisZoom.ts`, unit-tested). Because the stretch is independent of the mapbox zoom, every standard zoom mechanism (wheel, pinch, double-click, NavigationControl) changes both axes together and preserves the ratio; the `AxisZoomControls` cluster (bottom-right stack) does the per-axis ± and 1:1 reset. The transform breaks mapbox's own pointer math, so while stretched the frame disables mapbox's drag/scroll/box/rotate/pitch handlers and substitutes pointer/wheel handlers that convert visual→layout deltas, re-dispatches point-consuming mouse events (click/dblclick/mousemove/contextmenu) with corrected coordinates in the capture phase, and forces bearing/pitch to 0; at 1:1 the feature is fully inert (no transform, no listeners, all native handlers). DOM content inside the stretched frame is counter-scaled to stay crisp — waypoint markers/segment labels via CSS keyed on `[data-axis-stretch]` + `--axis-inv-sx/sy` vars, the rotated course/barb/hold labels inline (their angle is re-derived with `stretchRotationDeg` to stay parallel to the stretched leg), the DataBlock popup and mapbox ctrl corners per-anchor; `AircraftOverlay` (already outside the frame) instead multiplies `map.project()` output by the stretch scales and re-derives icon headings with `stretchTrackDeg`, and ProfilePanel's obstacle-avoidance projections do the same. GL-rendered content (basemap labels, procedure lines) stretches with the map by design.

**All-US airport index, built and validated offline.** The CIFP worker already parses every US airport with published procedures, but the curated 89-airport `airports.json` gates search reachability. `scripts/buildAirportIndex.ts` (`npm run build-airport-index`, flags `--force` to bypass the download cache, `--cifp <path>` to use a local CIFP zip, `--help`) joins the CIFP's enumerated airports against OurAirports metadata to emit `public/data/airport-index.json` (one compact row per airport with ≥1 published approach, ~2–3k rows — search corpus for `useAirportSearch`) and `public/data/airports/{key}.json` shards (metadata + runway geometry, fetched on selection like a map tile). **Sandbox caveat:** building the index requires unrestricted egress to `aeronav.faa.gov`, which some sandboxes block — until it's run somewhere unrestricted, the generated files don't exist and the app transparently falls back to the bundled 89-airport set. `scripts/validateStaticData.ts` (`npm run validate-static-data`, `--live` to also sample live upstream APIs with a seeded stratified selection) checks schema/coordinate sanity and CIFP↔index cross-checks; its posture is advisory — failures below a 2% threshold per category exit 0 and are appended to `TODO-data-issues.md` (one entry per distinct failure class, each meant to become its own follow-up fix) rather than failing the run. `scripts/lib/` holds the shared join/validation helpers (`csv.ts`, `cache.ts`, `runways.ts`, `airportIndex.ts`, `validate.ts`) used by both build scripts.

**Dual procedure visibility model.** `src/store/useProcedureStore.ts` keeps `userToggles` (explicit user action) and `autoVisible` (detection engine) separate. `isVisible(id) = userToggles[id] ?? autoVisible[id] ?? false`. "Revert to auto" clears `userToggles[id]`. The store also tracks `lastDetectedAt`, `detectedHexes` (confirmed aircraft per procedure — powers hover highlighting and the profile panel; array identity is stable when contents don't change), `aircraftAssignments` (hex → the one approach that aircraft is assigned to), and `autoShownIds`.

**Procedure auto-detection is a time-confirmed state machine.** `src/hooks/useProcedureDetection.ts` runs `src/geo/detectionMachine.ts` (a pure reducer) after each ADS-B poll. Per (aircraft, procedure) pair, `src/geo/procedureMatch.ts` produces instantaneous evidence (cross-track + direction via the shared `src/geo/lineMatching.ts` primitive — also used by flownSegment/activeSegments — plus altitude vs glideslope/constraints); a pair becomes a *candidate* on first match and is *confirmed* only after `DETECT_CONFIRM_MIN_MATCHES` matches over `DETECT_CONFIRM_MIN_DURATION_MS`, so one-poll crossings never latch. Confirmed tracks are re-evaluated with widened tolerances (and no altitude gate) and drop only after `DETECT_CONFIRMED_TTL_MS` of sustained lateral failure. Each aircraft is assigned to exactly one best approach (ATIS-informed `src/geo/approachPriority.ts`, min-cross-track tie-break, reassignment needs a 3-poll closer streak or an ATIS priority flip on the same runway) — parallel-runway dedupe falls out of assignment instead of suppression passes. SIDs/STARs get the same per-hex assignment treatment (min cross-track, sticky, streak-based reassignment; no ATIS rule), so sibling SIDs sharing initial runway legs don't all light up for one departure. SID/STAR confirmation additionally requires `DETECT_CONFIRM_MIN_PROGRESS_NM` of net along-track progress, which rejects aligned-but-loitering traffic, and aircraft squawking 1200 (`VFR_SQUAWK`) are excluded from detection entirely. Procedure activity, plane lists, and the `AUTO_HIDE_DELAY_MS` timeout all derive from confirmed assignments via `applyDetection`. Departures never create approach tracks (first-seen past the MAP is ignored), but missed approaches stay tracked (`preMapSeen`). Matching is **DME-arc-aware**: besides the representative (longest) transition's straight polyline, `evaluateMatch` also tests every arc feeder path (`buildArcMatchPaths` — one arc-sampled polyline per transition containing an `AF` leg, since arc feeders usually aren't the representative, e.g. KPAE VOR-A) and returns whichever the aircraft is laterally closest to; tracks key by (hex, procedure) so the arc→final handoff stays one track (approaches need no along-track progress, so the per-path `alongTrackNm` reset is harmless). `computeProcedureBbox` folds those same arc points into the prefilter box, or an aircraft established on the arc would be culled before it could match. **Holds are matched the same way** (`buildHoldMatchPaths` — one path per `kind:'hold'` GeoJSON racetrack): a holding aircraft flies the racetrack, not the straight representative, so without this it only matches on the inbound leg (which aligns with the final course) and flickers out through the outbound leg and both turns (~once per ~4-min lap). Hold matching uses deliberately generous tolerances (`HOLD_MATCH_XT_NM` 2 nm cross-track, `HOLD_MATCH_DIR_DEG` 75° — a flown hold varies from the drawn 0.85 nm-radius one with speed/leg-type/wind, and a holding aircraft turns continuously), leaning on the confirm/TTL hysteresis rather than instantaneous heading to reject transiting traffic; `preMap`/`pastMap` follow the hold's segment so a pre-MAP course reversal and a missed-approach hold hit the departure/missed gate correctly.

**ATIS-driven approach preference.** `src/api/datis.ts` parses the dATIS text clause-by-clause into per-runway approach-type preferences (each runway list gets only the type tokens since the previous runway list, so "ILS RWY 16L, RNAV RWY 16R" scopes correctly; "ILS OR LOC RWY 16L" → `{16L: ['I','L']}`), visual-approach runways (`visualRunways`), and departure runways. Split arrival/departure ATIS entries are both parsed and merged (`parseDatisEntries`). `useProcedureDetection` uses this to prefer the in-use approach type when multiple match; falls back to a static priority (`I > R > H > L`) when ATIS is unavailable. `useDatis` polls atis.info every 10 min per active airport (see Multi-airport state above) and `src/geo/approachPriority.ts` reads preferences by `proc.icao` out of `atisByIcao`.

**Route enrichment.** `src/hooks/useRouteEnrichment.ts` resolves any real callsign (anything that isn't the hex fallback) to origin→destination through `src/api/routes.ts`, a pluggable `RouteProvider` layer: one batched POST per poll to adsb.lol `/routeset` (keyless; server-side position-plausibility flag) with adsbdb as per-callsign fallback for confirmed misses. Positives cache for the session, confirmed negatives for `ROUTE_NEGATIVE_TTL_MS`, transient failures retry with capped exponential backoff. A commented seam exists for a future FlightAware AeroAPI provider (filed flight plans, `RouteResult.filedRoute`).

**Path prediction, hold-entry, and conflict/terrain alerting run as one per-poll engine.** `src/hooks/usePathEngine.ts` mounts immediately after `useProcedureDetection()` in `AppMap.tsx` — a comment there warns not to reorder them, since React runs same-dependency-array (`[lastPollMs]`) effects in hook-call order, and the path engine needs _this_ poll's freshly-computed `aircraftAssignments` to know which aircraft are established on an approach. Per poll it: records one `TrackPoint` per aircraft into `src/services/trackLog.ts` (deliberately a plain module-level `Map<hex, Ring>` of fixed-capacity ring buffers, **not** a Zustand store — it's written once per poll and read imperatively by the prediction engine and `TrackLogLayer`, so there's no reactive consumer to justify subscription/notification machinery; `TRACKLOG_MAX_POINTS` (720, ~1h at 5s polls) preallocates each hex's array so memory is bounded and old points are overwritten in place rather than shifted); predicts every airborne aircraft's path 5 minutes out at 5s steps (`src/geo/prediction.ts`) — an aircraft assigned to and currently established on an approach (`isOnProcedureNow`, checked against whichever of the procedure's guidance paths — representative / DME-arc feeder / hold racetrack — it's laterally closest to) walks that path via `turf.along`, riding the descent profile's `descentProfilePoints`/`glideslopeAltAt` vertically and converging at `max(|baroRate|, PREDICT_MIN_DESCENT_FPM)`; otherwise it extrapolates the turn rate observed over the last ~3 poll tracks, held for `PREDICT_TURN_HOLD_S` (15s) then linearly decayed to straight flight by `PREDICT_TURN_DECAY_END_S` (45s); TIS-B tracks (hex `~`-prefixed) are always forced straight, too noisy to trust a turn rate from. Predictions feed hold-entry prediction (`src/geo/holdEntry.ts` — AIM 5-3-8 70°-line sector classification into direct/teardrop/parallel, entry geometry built from the same `procedureShapes` semicircle/`HOLD_TURN_R` the drawn racetrack uses so a predicted entry visually mates with it, a pure hysteresis reducer that clears an entry once the aircraft crosses the fix established inbound, diverges for `HOLD_ENTRY_CLEAR_POLLS` (3) consecutive non-qualifying polls, or gains a procedure assignment), traffic-conflict evaluation (`src/geo/tcasTables.ts`'s DO-185B sensitivity-level table + `src/geo/conflicts.ts` — sampled closest-point-of-approach on the shared 5s prediction grid, tau/DMOD/ZTHR gating for TA/RA with RA climb/descend sense chosen by simulating both `RA_ESCAPE_FPM` (±1500 fpm, after a `RA_RESPONSE_DELAY_S` pilot-response delay) escape senses to see which achieves `ALIM` separation at CPA, plus an independent ForeFlight-style radar tier — 2.0nm/±1200ft/45s alert, 1.3nm/±1200ft/25s warning — precedence `ra > warning > ta > alert`, and low-AGL near-airport suppression so parallel-runway/pattern traffic doesn't false-alarm), and MSAW-style terrain scanning (`src/geo/terrainScan.ts` — checks MVA sector floors first since they already bake in an obstacle buffer, falling back to Mapbox terrain-rgb DEM only where no sector covers a point; suppressed within `TERRAIN_ONAPPROACH_TOL_FT` (400ft) of an approach's own descent profile). Both alerting passes desensitize near **known** airports, not just active ones — `src/services/knownAirports.ts` warms a flat position list from `/data/airport-index.json` (falling back to the legacy `airports.json`) so a KSEA arrival still reads as a normal approach while only KPAE is active: traffic alerts are suppressed below `TRAFFIC_SUPPRESS_AGL_FT` (1000 ft, ForeFlight-style pattern-altitude relief) near a field, terrain scanning carves an MSAW-style exclusion volume (`TERRAIN_AIRPORT_EXCLUDE_NM`/`_FT` — 4 nm / 1500 ft above field elevation) around any known airport regardless of approach assignment, and the radar tier additionally requires `RADAR_MIN_CLOSURE_NM` of actual convergence so stable parallel-approach pairs holding constant separation never latch an alert. Two further inhibits cover field-verified false alerts: a TAWS-style landing-configuration inhibit (`TERRAIN_LANDING_GS_KT`/`_AGL_FT`) suppresses terrain scanning whenever an aircraft is slow AND low above the actual DEM-derived ground, covering strips absent from the airport index entirely; and formation/duplicate-track suppression (`FORMATION_SUPPRESS_NM`/`_DALT_FT`/`_TRK_DEG`/`_GS_KT` in `src/geo/conflicts.ts`) drops a traffic-conflict pair outright when both aircraft sustain near-identical position, altitude, track, and speed, since matched velocity means zero closure and the same gate also catches duplicate ADS-B/TIS-B tracks of one airframe — two more gates in the same loop catch what that 0.5nm radius misses: a wider-tolerance `TISB_SHADOW_NM`/`_DALT_FT`/`_TRK_DEG`/`_GS_KT` check for a co-moving TIS-B trackfile (up to ~60s stale, so it can trail 2+ nm), and an outright same-`registration`/`flight` dedupe regardless of geometry. All four results land in one `usePathStore.setResults()` call per poll, bumping a single `pathRevision` counter that every consumer (`RangeRingsLayer`, `TrackLogLayer`, `HoldEntryLayer`, `PredictionLayer`, `AircraftOverlay`, `DataBlock`) subscribes to instead of the Maps themselves. `AircraftOverlay` wraps an alerted aircraft's label in an amber border + filled chip (`TRAFFIC`/`TERRAIN`/`TA`) or a blinking red bar + chip (`TRAFFIC`/`TERRAIN`/`RA ↑`/`RA ↓`) keyed off `AircraftAlert.tier`; `DataBlock` (rendered via `SelectedAircraftDataBlock`) duplicates the same chip logic for the selected aircraft's popup — both re-render only on `pathRevision` (poll cadence), with the blink itself pure CSS. **Alerting is filter-aware:** `usePathEngine` computes a `hiddenHexes` set each poll mirroring `AircraftOverlay`'s hide rules (TIS-B `~`+`showTisb`, VFR squawk+`showVfr`, altitude-slider min/max) and drops radar-tier (`alert`/`warning`) conflict pairs, terrain scans, and hold-entry inputs for hidden aircraft — no warnings about a plane you can't see; the sole exception is TCAS TA/RA, which still evaluates across ALL aircraft, and when a TA/RA fires involving a hidden plane its hex is added to `usePathStore.forcedVisibleHexes` (consumed by the overlay) to force-un-hide it until the alert resolves; the same radar-tier post-filter also drops an `alert`/`warning` pair when both aircraft are established on an approach (assigned + `isOnProcedureNow`, computed once per aircraft and shared with the terrain pass's `onApproach` flag), mirroring real STARS Conflict Alert's approach-context inhibit for ATC-separated parallel-final/in-trail traffic — TCAS TA/RA is exempt and still evaluates them.

**Terrain alerting needs MVA sectors loaded independent of the map's `showMva` display toggle.** A second effect in `usePathEngine` calls `ensureMvaLoaded(key)` for every active airport regardless of whether the user has MVA sectors turned on for display — the terrain scan reads the same sectors the map would draw, and hiding them visually must not silently disable the safety check. The same effect calls `prefetchAround` to warm the 2×2 nearest terrain-rgb tiles around each active airport so `elevationFtAt` (`src/services/terrainElevation.ts`) is more likely to already have a decoded tile the first time the scan needs one. That service fetches `.pngraw` tiles **directly from `api.mapbox.com`** with `VITE_MAPBOX_TOKEN` — unlike every other upstream in this app it is deliberately not proxied through `/api/*`, since the Mapbox token is already public/client-side by design (see Required environment variables above) — and decodes them into a memory-only LRU of `TERRAIN_TILE_CACHE_MAX` (48) tiles stored as `Int16Array` feet rather than `Float32Array` meters, bounding the resident footprint to ~6 MiB. Reads are synchronous and cache-only: a miss kicks off an async fetch+decode and returns `undefined` immediately, and the per-poll scan just skips that point and retries next poll once the tile lands — no prediction step ever blocks on network I/O.

**`RangeRingsLayer` follows the selected aircraft with the same imperative `setData` pattern the aircraft-interpolation loop uses (see "Aircraft at 60fps" above), the one other per-frame map consumer in the app.** It drives its own `requestAnimationFrame` loop rather than re-rendering through React, since the three rings (radii bucketed by zoom via `src/geo/rangeRings.ts`'s `RING_ZOOM_BUCKETS`) must track the selected aircraft's interpolated position every frame, not just once per poll; a cheap epsilon check on lat/lon skips the `setData` call on frames where the position hasn't meaningfully moved. The "N NM" badge labels are DOM `Marker`s refreshed on a much cheaper 250ms `setInterval` instead, since sub-frame precision doesn't matter for text — with a 12→6 o'clock fallback when the 12 o'clock point projects off the top of the viewport.

**Map overlays** (in `src/components/map/`, render order matters — see the comment block at the top of `AppMap.tsx`):

- `ProcedureLayer` — the procedure route lines, colored per `src/utils/colorScheme.ts`'s per-airport hue family (cyan/indigo/emerald SID/STAR/APPROACH for the first airport, a distinct trio per additional airport). Past `MAX_RENDERED_PROCEDURE_LINES` simultaneously-visible lines (~5 GL layers each), `AppMap` shows a dismissible hint to hide procedures or collapse airport sections — it never culls a line silently. **Approach feeder legs draw thin.** An approach transition that never reaches the MAP is a feeder (initial fix → the common IAF/IF where the final begins); the parser tags its inbound path feature `feeder: true` (in `buildProcedureFeatures`, only when some transition has a MAP, so no SID/STAR leg is ever mistaken for one), and `ProcedureLayer` draws feeders thin (a separate `proc-feeder-*` layer) regardless of detection so several feeders fanning into one approach (e.g. KPAE R34L: PAE + SEA → RARYO) don't clutter the map. The final segment keeps its detection-driven width; the feeder an aircraft is actually flying is thickened on top by the active-segment layers. **Transition holds (HILPT racetracks) draw at an intermediate weight** (`proc-hold-*` layer, between the thin feeders and the active final — the hold is part of the approach unless ATC clears skipping it); a holding aircraft thickens the **whole racetrack** to the active width (`findActiveSegments` emits the entire `kind:'hold'` feature, checked against every airborne aircraft including the selected one, using the same `HOLD_MATCH_*` tolerances as detection). Missed-approach holds stay dash-dot (`proc-missed-*`).
- `WaypointMarkers` — DOM markers for fixes with FAA-style over/under altitude bars, speed limits, glideslope-intercept bolt, flyover, and DME rings. Past `MAX_ONSCREEN_WAYPOINT_SYMBOLS` on-screen fixes, degrades to icon-only glyphs (skips the label-collision placement pass, which is also what makes it cheaper, not just less cluttered).
- `AirportLabelsLayer` — ICAO/LID symbol labels at each active airport; hovering an `AirportSection` header in the sidebar highlights its map label.
- `FlownSegmentLayer` / `AutoActiveSegmentsLayer` — highlight the specific leg(s) aircraft are actively flying (`src/geo/flownSegment.ts`, `activeSegments.ts`).
- `ExtendedCenterlineLayer` — runway extended centerlines (`src/geo/extendedCenterline.ts`), toggle + length in settings.
- `RangeRingsLayer` / `TrackLogLayer` / `HoldEntryLayer` / `PredictionLayer` — the path-prediction overlay stack, mounted (in that bottom-to-top order) between `FlownSegmentLayer` and `WaypointMarkers`: range rings around the selected aircraft (zoom-bucketed radii, `src/geo/rangeRings.ts`), its flown trail colored by altitude (`src/services/trackLog.ts`), every in-flight aircraft's predicted FAA hold-entry lead-in (`src/geo/holdEntry.ts`), and the selected aircraft's predicted path — conflict pairs force-show **both** aircraft's paths tier-colored amber/red regardless of selection (`src/geo/prediction.ts`, `src/geo/conflicts.ts`). `PathControls` (bottom-right stack, above `TrafficFilter`) toggles predicted paths (PRED + 1'/2'/3'/5' horizon) and range rings.
- `RunwayLayer`, `AircraftOverlay`, `SelectedAircraftDataBlock` (TRACON-style data block for the selected target), `AltitudeFilter` (dual-handle slider, 20 positions SFC→Class A, see `src/utils/altitudeFilter.ts`). `AircraftOverlay` and the data block also render traffic/terrain alert chrome — see the path-prediction entry above.
- `ActiveProceduresOverlay` (`src/components/layout/`) — the "IN USE" list; groups rows under a per-airport ident sub-header with an ATIS badge once 2+ airports are active, and scrolls past 3+.

## Data sources

| Data | Source | How loaded |
| --- | --- | --- |
| Live aircraft | ADS-B Exchange `/lat/.../lon/.../dist/` | Proxied via `/api/adsbx`, one clustered TanStack Query per covering circle of nearby active airports (`useAircraftPoll`, `src/geo/clusterAirports.ts`) |
| Procedure names + geometry | FAA CIFP (ARINC 424, 28-day AIRAC cycle) | Proxied via `/api/faa-cifp`, parsed in worker, cached per-airport in IndexedDB (see CIFP caching above). aviationapi.com is **not** used at runtime — it was dead code (`fetchCharts`, deleted); `scripts/validateStaticData.ts --live` still samples it directly (unproxied, from Node) purely to sanity-check chart-name shapes |
| dATIS | atis.info `/api` | Proxied via `/api/datis`, one 10-min poll per active airport (`useDatis`) |
| Callsign routes | adsb.lol `/api/0/routeset` (primary), adsbdb.com fallback | Proxied via `/api/adsblol` + `/api/adsbdb`, keyless, batched, cached (see `src/api/routes.ts`) |
| MVA/MIA sectors | FAA AIXM per-TRACON (`aeronav.faa.gov/MVA_Charts/aixm`) | Proxied via `/api/faa-mva`, parsed (`utils/aixmMva.ts`), cached in IndexedDB (`services/mvaData.ts`) |
| Airspace (Class B/C/D/E) | FAA AIS `Class_Airspace` ArcGIS FeatureServer | Proxied via `/api/faa-airspace`, bbox GeoJSON query per airport (`api/faaAirspace.ts`), cached in IndexedDB (`services/airspaceData.ts`) |
| Airport search index | `public/data/airport-index.json` (all US airports with published approaches, ~2–3k) | Built by `scripts/buildAirportIndex.ts` (`npm run build-airport-index`); fetched once, searched with Fuse.js (`useAirportSearch`) |
| Per-airport shard | `public/data/airports/{key}.json` (metadata + runway geometry) | Fetched on airport selection like a map tile (`useRunways`); falls back to the legacy `runways.json`, then to CIFP-synthesized runway geometry, so no active airport ever renders runway-less |
| Airport list (legacy) | `public/data/airports.json` (89 major US airports) | Bundled; used as `AirportSearch`'s fallback until `airport-index.json` is generated |
| Runway geometry (legacy) | `public/data/runways.json` (86 airports) | Middle tier of the per-airport shard's fallback chain above |

`airport-index.json` and `airports/{key}.json` are **generated, not hand-written** — they aren't gitignored and are committed once produced, but building them requires unrestricted network egress to `aeronav.faa.gov` (blocked in some sandboxes). Until they exist, the app transparently falls back to the bundled legacy files above; no code path assumes they're present.

Dev proxies are defined in `vite.config.ts` (`/api/adsbx`,
`/api/faa-cifp`, `/api/adsbdb`, `/api/adsblol`, `/api/datis`, `/api/dtpp`,
`/api/faa-mva`, `/api/faa-airspace`) to avoid CORS in the browser. In
production the same `/api/*` paths are served by the Azure Functions
catch-all proxy in `api/src/functions/proxy.ts` — when adding an upstream,
update **both** route tables.

To regenerate the legacy curated 89-airport set, run:

```sh
npm install -D unzipper   # if not installed
npx tsx scripts/buildStaticData.ts   # or: npm run build-static-data
```

To (re)build the full all-US-airports search index + per-airport shards
instead (needs unrestricted network egress — see Data sources), run
`npm run build-airport-index`, then `npm run validate-static-data` to sanity-check
the output.

## Configuration

All tunable thresholds live in `src/config/constants.ts` — poll interval, search
radius, multi-airport limits (`MAX_ACTIVE_AIRPORTS`, `MAX_ACTIVE_AIRPORTS_SOFT`),
render budgets (`MAX_RENDERED_PROCEDURE_LINES`, `MAX_ONSCREEN_WAYPOINT_SYMBOLS`),
ADS-B poll clustering (`POLL_CLUSTER_MAX_RADIUS_NM`), detection-machine gates and
hysteresis (`DETECT_*`, including the bbox prefilter pad `DETECT_BBOX_PAD_NM`),
glideslope math, route-cache TTLs/backoff (`ROUTE_*`), auto-hide delay,
extended-centerline length, map styles, per-axis zoom step/limit (`AXIS_ZOOM_STEP`, `AXIS_ZOOM_MAX_RATIO`), and AIRAC/NASR cycle constants. The
path-prediction engine adds its own groups: `TRACKLOG_*` (ring-buffer capacity,
gap-break), `PREDICT_*` (step/horizon, turn-rate clamps and hold/decay timing,
profile-capture tolerance), `HOLD_ENTRY_*` (trigger bearing/ETA/pass-distance
gates, alt tolerance, clear-poll hysteresis, dash pattern), `CONFLICT_*` /
`RADAR_*` (CPA horizon, prefilter, RA escape-maneuver model, ForeFlight-style
radar separation tiers — the TCAS TA/RA sensitivity-level table itself is
`TCAS_SL_TABLE` in `src/geo/tcasTables.ts`, not `constants.ts`), and
`TERRAIN_*` / `RING_ZOOM_BUCKETS` (DEM tile zoom/cache size, MVA/DEM clearance
thresholds, ring radii per zoom bucket).
User-adjustable values (poll interval, radius, centerline toggle/length, altitude
filter, predicted-path visibility/horizon, range rings) live in `useSettingsStore`
and persist to localStorage. Active airports + their per-airport ATIS also
persist (`useAirportStore`); sidebar collapse state persists via `usePaneStore`.

## Testing

Vitest with `jsdom` + globals (`vitest.config.ts`). ~696 tests, unit tests
colocated in `__tests__/` folders under `geo/`, `utils/`, `api/`, `store/`,
`services/`, `hooks/`, and `workers/`. There are no component/integration tests —
the interpolation loop and map layers are untested by design (the `api/` suites
test parsing/caching with a stubbed `fetch`). When changing ARINC parsing,
altitude constraints, AIRAC math, detection geometry/state-machine rules, ATIS
parsing, route caching, airport-index build/validation logic, multi-airport
store reducers (merge/remove, color assignment, clustering), or path-prediction
logic (approach-following/turn-rate prediction, hold-entry classification and
its hysteresis reducer, traffic-conflict CPA/tau/sensitivity-level math, terrain
scan MVA/DEM gating, or the tracklog ring buffer), add/adjust the matching unit
test.

## TypeScript notes

- `moduleResolution: "node"` (not "bundler") — required for `@turf/turf` type resolution
- `allowSyntheticDefaultImports: true` — required for Fuse.js default import
- `strict: true`, `noUnusedLocals`, `noUnusedParameters` are on — dead code fails the build
- CSS module types declared in `src/vite-env.d.ts`
- Build splits vendor chunks (mapbox, turf, react-vendor) via `manualChunks` in `vite.config.ts`
