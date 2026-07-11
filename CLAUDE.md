# Approach Map

A localhost web app that visualizes live ADS-B aircraft positions relative to published FAA instrument procedures (SIDs, STARs, Approaches) at US airports. Think TRACON radar display with modern styling.

## Stack

- **React 18 + TypeScript + Vite** — no Next.js, plain Vite SPA
- **react-map-gl v7 + mapbox-gl v2** — v7 to avoid Mapbox v3 license complexity
- **Zustand** for state (7 stores: aircraft, airport, map, pane, procedure, selection, settings); **TanStack Query v5** for the clustered ADS-B poll
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
  geo/           Pure geo functions + __tests__ (detection, segments, centerline, shapes, interpolation, clusterAirports)
  hooks/         React glue: polling, interpolation loop, detection, enrichment, dATIS, AIRAC lifecycle, airport search, pane mode
  services/      cifpCache.ts (per-airport IndexedDB cache) + db.ts (injectable KVStore seam), mvaData.ts, airspaceData.ts
  store/         Zustand stores (aircraft, airport, map, pane, procedure, selection, settings)
  types/         Shared TS types (aircraft, airport, procedure)
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

**CIFP uses AIRAC-cycle-aware IndexedDB caching.** The FAA CIFP file (~9MB zip) follows the 28-day AIRAC cycle. `src/services/cifpCache.ts` downloads, parses (in `src/workers/cifpParser.worker.ts`), and stores in IndexedDB keyed by cycle effective date **and** `PARSER_VERSION` (currently 21 — bump it whenever parser logic changes so stale/buggy parses are discarded). `src/hooks/useAiracCycle.ts` drives the lifecycle: a `setTimeout` fires at the exact next-cycle boundary to refresh, and a `visibilitychange` listener handles tabs backgrounded across a boundary. Reference: `src/utils/airac.ts` for cycle math. Storage is per-airport, not one monolithic blob: the worker writes `airport:{key}` records plus meta keys (`effectiveDate`, `parserVersion`, `index`), and `useCifpStore` warms airports lazily via `ensureAirport(key)` on selection so cold-start memory stays bounded regardless of how many US airports are indexed. An injectable `dbGet`/`dbPut` seam (`src/services/db.ts`, `KVStore`) lets tests fake IndexedDB instead of hitting a real one.

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

**All-US airport index, built and validated offline.** The CIFP worker already parses every US airport with published procedures, but the curated 89-airport `airports.json` gates search reachability. `scripts/buildAirportIndex.ts` (`npm run build-airport-index`, flags `--force` to bypass the download cache, `--cifp <path>` to use a local CIFP zip, `--help`) joins the CIFP's enumerated airports against OurAirports metadata to emit `public/data/airport-index.json` (one compact row per airport with ≥1 published approach, ~2–3k rows — search corpus for `useAirportSearch`) and `public/data/airports/{key}.json` shards (metadata + runway geometry, fetched on selection like a map tile). **Sandbox caveat:** building the index requires unrestricted egress to `aeronav.faa.gov`, which some sandboxes block — until it's run somewhere unrestricted, the generated files don't exist and the app transparently falls back to the bundled 89-airport set. `scripts/validateStaticData.ts` (`npm run validate-static-data`, `--live` to also sample live upstream APIs with a seeded stratified selection) checks schema/coordinate sanity and CIFP↔index cross-checks; its posture is advisory — failures below a 2% threshold per category exit 0 and are appended to `TODO-data-issues.md` (one entry per distinct failure class, each meant to become its own follow-up fix) rather than failing the run. `scripts/lib/` holds the shared join/validation helpers (`csv.ts`, `cache.ts`, `runways.ts`, `airportIndex.ts`, `validate.ts`) used by both build scripts.

**Dual procedure visibility model.** `src/store/useProcedureStore.ts` keeps `userToggles` (explicit user action) and `autoVisible` (detection engine) separate. `isVisible(id) = userToggles[id] ?? autoVisible[id] ?? false`. "Revert to auto" clears `userToggles[id]`. The store also tracks `lastDetectedAt`, `detectedHexes` (confirmed aircraft per procedure — powers hover highlighting and the profile panel; array identity is stable when contents don't change), `aircraftAssignments` (hex → the one approach that aircraft is assigned to), and `autoShownIds`.

**Procedure auto-detection is a time-confirmed state machine.** `src/hooks/useProcedureDetection.ts` runs `src/geo/detectionMachine.ts` (a pure reducer) after each ADS-B poll. Per (aircraft, procedure) pair, `src/geo/procedureMatch.ts` produces instantaneous evidence (cross-track + direction via the shared `src/geo/lineMatching.ts` primitive — also used by flownSegment/activeSegments — plus altitude vs glideslope/constraints); a pair becomes a *candidate* on first match and is *confirmed* only after `DETECT_CONFIRM_MIN_MATCHES` matches over `DETECT_CONFIRM_MIN_DURATION_MS`, so one-poll crossings never latch. Confirmed tracks are re-evaluated with widened tolerances (and no altitude gate) and drop only after `DETECT_CONFIRMED_TTL_MS` of sustained lateral failure. Each aircraft is assigned to exactly one best approach (ATIS-informed `src/geo/approachPriority.ts`, min-cross-track tie-break, reassignment needs a 3-poll closer streak or an ATIS priority flip on the same runway) — parallel-runway dedupe falls out of assignment instead of suppression passes. SIDs/STARs get the same per-hex assignment treatment (min cross-track, sticky, streak-based reassignment; no ATIS rule), so sibling SIDs sharing initial runway legs don't all light up for one departure. SID/STAR confirmation additionally requires `DETECT_CONFIRM_MIN_PROGRESS_NM` of net along-track progress, which rejects aligned-but-loitering traffic, and aircraft squawking 1200 (`VFR_SQUAWK`) are excluded from detection entirely. Procedure activity, plane lists, and the `AUTO_HIDE_DELAY_MS` timeout all derive from confirmed assignments via `applyDetection`. Departures never create approach tracks (first-seen past the MAP is ignored), but missed approaches stay tracked (`preMapSeen`).

**ATIS-driven approach preference.** `src/api/datis.ts` parses the dATIS text clause-by-clause into per-runway approach-type preferences (each runway list gets only the type tokens since the previous runway list, so "ILS RWY 16L, RNAV RWY 16R" scopes correctly; "ILS OR LOC RWY 16L" → `{16L: ['I','L']}`), visual-approach runways (`visualRunways`), and departure runways. Split arrival/departure ATIS entries are both parsed and merged (`parseDatisEntries`). `useProcedureDetection` uses this to prefer the in-use approach type when multiple match; falls back to a static priority (`I > R > H > L`) when ATIS is unavailable. `useDatis` polls atis.info every 10 min per active airport (see Multi-airport state above) and `src/geo/approachPriority.ts` reads preferences by `proc.icao` out of `atisByIcao`.

**Route enrichment.** `src/hooks/useRouteEnrichment.ts` resolves any real callsign (anything that isn't the hex fallback) to origin→destination through `src/api/routes.ts`, a pluggable `RouteProvider` layer: one batched POST per poll to adsb.lol `/routeset` (keyless; server-side position-plausibility flag) with adsbdb as per-callsign fallback for confirmed misses. Positives cache for the session, confirmed negatives for `ROUTE_NEGATIVE_TTL_MS`, transient failures retry with capped exponential backoff. A commented seam exists for a future FlightAware AeroAPI provider (filed flight plans, `RouteResult.filedRoute`).

**Map overlays** (in `src/components/map/`, render order matters — see the comment block at the top of `AppMap.tsx`):

- `ProcedureLayer` — the procedure route lines, colored per `src/utils/colorScheme.ts`'s per-airport hue family (cyan/indigo/emerald SID/STAR/APPROACH for the first airport, a distinct trio per additional airport). Past `MAX_RENDERED_PROCEDURE_LINES` simultaneously-visible lines (~5 GL layers each), `AppMap` shows a dismissible hint to hide procedures or collapse airport sections — it never culls a line silently.
- `WaypointMarkers` — DOM markers for fixes with FAA-style over/under altitude bars, speed limits, glideslope-intercept bolt, flyover, and DME rings. Past `MAX_ONSCREEN_WAYPOINT_SYMBOLS` on-screen fixes, degrades to icon-only glyphs (skips the label-collision placement pass, which is also what makes it cheaper, not just less cluttered).
- `AirportLabelsLayer` — ICAO/LID symbol labels at each active airport; hovering an `AirportSection` header in the sidebar highlights its map label.
- `FlownSegmentLayer` / `AutoActiveSegmentsLayer` — highlight the specific leg(s) aircraft are actively flying (`src/geo/flownSegment.ts`, `activeSegments.ts`).
- `ExtendedCenterlineLayer` — runway extended centerlines (`src/geo/extendedCenterline.ts`), toggle + length in settings.
- `RunwayLayer`, `AircraftOverlay`, `SelectedAircraftDataBlock` (TRACON-style data block for the selected target), `AltitudeFilter` (dual-handle slider, 20 positions SFC→Class A, see `src/utils/altitudeFilter.ts`).
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
extended-centerline length, map styles, and AIRAC/NASR cycle constants.
User-adjustable values (poll interval, radius, centerline toggle/length, altitude
filter) live in `useSettingsStore` and persist to localStorage. Active airports +
their per-airport ATIS also persist (`useAirportStore`); sidebar collapse state
persists via `usePaneStore`.

## Testing

Vitest with `jsdom` + globals (`vitest.config.ts`). ~513 tests, unit tests
colocated in `__tests__/` folders under `geo/`, `utils/`, `api/`, `store/`,
`services/`, `hooks/`, and `workers/`. There are no component/integration tests —
the interpolation loop and map layers are untested by design (the `api/` suites
test parsing/caching with a stubbed `fetch`). When changing ARINC parsing,
altitude constraints, AIRAC math, detection geometry/state-machine rules, ATIS
parsing, route caching, airport-index build/validation logic, or multi-airport
store reducers (merge/remove, color assignment, clustering), add/adjust the
matching unit test.

## TypeScript notes

- `moduleResolution: "node"` (not "bundler") — required for `@turf/turf` type resolution
- `allowSyntheticDefaultImports: true` — required for Fuse.js default import
- `strict: true`, `noUnusedLocals`, `noUnusedParameters` are on — dead code fails the build
- CSS module types declared in `src/vite-env.d.ts`
- Build splits vendor chunks (mapbox, turf, react-vendor) via `manualChunks` in `vite.config.ts`
