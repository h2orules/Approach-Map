# Approach Map

A localhost web app that visualizes live ADS-B aircraft positions relative to published FAA instrument procedures (SIDs, STARs, Approaches) at US airports. Think TRACON radar display with modern styling.

## Stack

- **React 18 + TypeScript + Vite** — no Next.js, plain Vite SPA
- **react-map-gl v7 + mapbox-gl v2** — v7 to avoid Mapbox v3 license complexity
- **Zustand** for state (5 stores); **TanStack Query v5** for the ADS-B poll
- **@turf/turf v6** for geo math (cross-track distance, dead-reckoning, bearings)
- **Fuse.js** for fuzzy airport search over bundled `public/data/airports.json`
- **fflate** for ZIP extraction (CIFP download is a ZIP, not gzip)
- **clsx** for conditional classNames

## Required environment variables

Copy `.env.example` to `.env.local` and fill in:

- `VITE_MAPBOX_TOKEN` — Mapbox public token (account.mapbox.com, scopes: styles:read, tiles:read)
- `VITE_ADSBX_API_KEY` — ADS-B Exchange supporter-tier API key (sent as `X-RapidAPI-Key`)

The dATIS (atis.info) and adsbdb route-lookup APIs are keyless — no config needed.

## Dev

```sh
npm run dev              # Vite dev server on :5173 with dev-proxies (see below)
npm run test             # Vitest (~240 unit tests) — watch mode
npm run test:ui          # Vitest UI
npm run build            # tsc -b && vite build (production)
npm run preview          # Preview a production build
npm run build-static-data # Regenerate public/data/*.json (see Data sources)
```

There is no ESLint/Prettier config in the repo; match the surrounding code style
(2-space indent, single quotes, no semicolons, CSS Modules per component).

## Directory layout

```
src/
  api/           Thin fetch wrappers, one per upstream (adsbx, aviationApi, datis, routes=adsb.lol+adsbdb)
  components/    React UI, grouped by area (airport, controls, layout, map, procedures)
                 Each component pairs with a co-located *.module.css
  config/        constants.ts — all tunable thresholds live here
  geo/           Pure geo functions + __tests__ (detection, segments, centerline, shapes, interpolation)
  hooks/         React glue: polling, interpolation loop, detection, enrichment, dATIS, AIRAC lifecycle
  services/      cifpCache.ts — IndexedDB + Zustand store for parsed CIFP
  store/         Zustand stores (aircraft, airport, map, procedure, settings)
  types/         Shared TS types (aircraft, airport, procedure)
  utils/         Pure helpers + __tests__ (airac, arincCoords, altitude*, airlines, aircraftTypes, colorScheme, formatters, mapImages)
  workers/       cifpParser.worker.ts — parses ARINC 424 off the main thread
scripts/         buildStaticData.ts — regenerates public/data/*.json
public/data/     airports.json (88 airports), runways.json (85 airports)
```

App composition: `App.tsx` → `TopBar` + `Sidebar` (airport search, procedure list,
settings) + `AppMap`. `AppMap` mounts all the map layers and wires up every hook.

## Key architecture decisions

**Aircraft at 60fps without React re-renders.** `src/hooks/useAircraftInterpolation.ts` runs a `requestAnimationFrame` loop, dead-reckons positions via `turf.destination()`, and calls `mapboxSource.setData()` directly — bypassing React entirely. React only re-renders the aircraft layer when the aircraft _set_ changes, which `useAircraftStore` signals via a `revision` counter bumped only on poll (not on interpolation).

**CIFP uses AIRAC-cycle-aware IndexedDB caching.** The FAA CIFP file (~9MB zip) follows the 28-day AIRAC cycle. `src/services/cifpCache.ts` downloads, parses (in `src/workers/cifpParser.worker.ts`), and stores in IndexedDB keyed by cycle effective date **and** `PARSER_VERSION` (bump it whenever parser logic changes so stale/buggy parses are discarded). `src/hooks/useAiracCycle.ts` drives the lifecycle: a `setTimeout` fires at the exact next-cycle boundary to refresh, and a `visibilitychange` listener handles tabs backgrounded across a boundary. Reference: `src/utils/airac.ts` for cycle math.

CIFP file facts (verified against live FAA data, June 2026):

- Zip URL is `CIFP_YYMMDD.zip` (6-digit date, e.g. `CIFP_260611.zip`), AIRAC reference `2024-01-25`.
- The ARINC 424 data file inside is named `FAACIFP18` (no extension), alongside PDFs/xlsx.
- Airport-section records (`P`): section code at col 5, ICAO at cols 7–10, **subsection at col 13** (`D`=SID, `E`=STAR, `F`=Approach, `C`=terminal waypoint). Enroute (`E`) and navaid (`D`) records put subsection at col 6 instead.
- SID/STAR/approach legs carry NO embedded lat/lon — fix coordinates are looked up by name from terminal-waypoint (`PC`) and enroute (`EA`) records (lat at cols 33–41, lon 42–51). See `src/utils/arincCoords.ts`.
- Legs also carry altitude/speed constraints, DME (Rho, cols 67–70), a recommended navaid (cols 51–54), and description codes (flyover, etc.) that the parser turns into renderable `WaypointSymbol`s.
- Each procedure has multiple transitions (runway + enroute) that restart sequence numbers; the parser keys waypoints by transition to avoid collisions and draws one line per transition.

**Dual procedure visibility model.** `src/store/useProcedureStore.ts` keeps `userToggles` (explicit user action) and `autoVisible` (detection engine) separate. `isVisible(id) = userToggles[id] ?? autoVisible[id] ?? false`. "Revert to auto" clears `userToggles[id]`. The store also tracks `lastDetectedAt`, `detectedHexes` (confirmed aircraft per procedure — powers hover highlighting and the profile panel; array identity is stable when contents don't change), `aircraftAssignments` (hex → the one approach that aircraft is assigned to), and `autoShownIds`.

**Procedure auto-detection is a time-confirmed state machine.** `src/hooks/useProcedureDetection.ts` runs `src/geo/detectionMachine.ts` (a pure reducer) after each ADS-B poll. Per (aircraft, procedure) pair, `src/geo/procedureMatch.ts` produces instantaneous evidence (cross-track + direction via the shared `src/geo/lineMatching.ts` primitive — also used by flownSegment/activeSegments — plus altitude vs glideslope/constraints); a pair becomes a *candidate* on first match and is *confirmed* only after `DETECT_CONFIRM_MIN_MATCHES` matches over `DETECT_CONFIRM_MIN_DURATION_MS`, so one-poll crossings never latch. Confirmed tracks are re-evaluated with widened tolerances (and no altitude gate) and drop only after `DETECT_CONFIRMED_TTL_MS` of sustained lateral failure. Each aircraft is assigned to exactly one best approach (ATIS-informed `src/geo/approachPriority.ts`, min-cross-track tie-break, reassignment needs a 3-poll closer streak or an ATIS priority flip on the same runway) — parallel-runway dedupe falls out of assignment instead of suppression passes. Procedure activity, plane lists, and the `AUTO_HIDE_DELAY_MS` timeout all derive from confirmed assignments via `applyDetection`. Departures never create approach tracks (first-seen past the MAP is ignored), but missed approaches stay tracked (`preMapSeen`).

**ATIS-driven approach preference.** `src/api/datis.ts` parses the dATIS text clause-by-clause into per-runway approach-type preferences (each runway list gets only the type tokens since the previous runway list, so "ILS RWY 16L, RNAV RWY 16R" scopes correctly; "ILS OR LOC RWY 16L" → `{16L: ['I','L']}`), visual-approach runways (`visualRunways`), and departure runways. Split arrival/departure ATIS entries are both parsed and merged (`parseDatisEntries`). `useProcedureDetection` uses this to prefer the in-use approach type when multiple match; falls back to a static priority (`I > R > H > L`) when ATIS is unavailable. `useDatis` polls atis.info every 10 min.

**Route enrichment.** `src/hooks/useRouteEnrichment.ts` resolves any real callsign (anything that isn't the hex fallback) to origin→destination through `src/api/routes.ts`, a pluggable `RouteProvider` layer: one batched POST per poll to adsb.lol `/routeset` (keyless; server-side position-plausibility flag) with adsbdb as per-callsign fallback for confirmed misses. Positives cache for the session, confirmed negatives for `ROUTE_NEGATIVE_TTL_MS`, transient failures retry with capped exponential backoff. A commented seam exists for a future FlightAware AeroAPI provider (filed flight plans, `RouteResult.filedRoute`).

**Map overlays** (in `src/components/map/`, render order matters — see the comment block at the top of `AppMap.tsx`):

- `ProcedureLayer` — the procedure route lines, colored per `src/utils/colorScheme.ts` (cyan SIDs, indigo STARs, green approaches).
- `WaypointMarkers` — DOM markers for fixes with FAA-style over/under altitude bars, speed limits, glideslope-intercept bolt, flyover, and DME rings.
- `FlownSegmentLayer` / `AutoActiveSegmentsLayer` — highlight the specific leg(s) aircraft are actively flying (`src/geo/flownSegment.ts`, `activeSegments.ts`).
- `ExtendedCenterlineLayer` — runway extended centerlines (`src/geo/extendedCenterline.ts`), toggle + length in settings.
- `RunwayLayer`, `AircraftOverlay`, `SelectedAircraftDataBlock` (TRACON-style data block for the selected target), `AltitudeFilter` (dual-handle slider, 20 positions SFC→Class A, see `src/utils/altitudeFilter.ts`).

## Data sources

| Data | Source | How loaded |
| --- | --- | --- |
| Live aircraft | ADS-B Exchange `/lat/.../lon/.../dist/` | Proxied via `/api/adsbx`, polled via TanStack Query (`useAircraftPoll`) |
| Procedure names | aviationapi.com `/api/v1/charts?apt=ICAO` | Proxied via `/api/aviationapi` |
| Procedure geometry | FAA CIFP (ARINC 424, 28-day AIRAC cycle) | Proxied via `/api/faa-cifp`, parsed in worker, cached in IndexedDB |
| dATIS | atis.info `/api` | Proxied via `/api/datis`, polled every 10 min |
| Callsign routes | adsb.lol `/api/0/routeset` (primary), adsbdb.com fallback | Proxied via `/api/adsblol` + `/api/adsbdb`, keyless, batched, cached (see `src/api/routes.ts`) |
| MVA/MIA sectors | FAA AIXM per-TRACON (`aeronav.faa.gov/MVA_Charts/aixm`) | Proxied via `/api/faa-mva`, parsed (`utils/aixmMva.ts`), cached in IndexedDB (`services/mvaData.ts`) |
| Airspace (Class B/C/D/E) | FAA AIS `Class_Airspace` ArcGIS FeatureServer | Proxied via `/api/faa-airspace`, bbox GeoJSON query per airport (`api/faaAirspace.ts`), cached in IndexedDB (`services/airspaceData.ts`) |
| Airport list | `public/data/airports.json` (88 major US airports) | Bundled; Fuse.js search |
| Runway geometry | `public/data/runways.json` (85 airports) | Loaded on airport select (`useRunways`) |

Dev proxies are defined in `vite.config.ts` (`/api/adsbx`, `/api/aviationapi`,
`/api/faa-cifp`, `/api/adsbdb`, `/api/datis`, `/api/dtpp`, `/api/faa-mva`,
`/api/faa-airspace`) to avoid CORS in the browser.

To expand runway/airport coverage, run:

```sh
npm install -D unzipper   # if not installed
npx tsx scripts/buildStaticData.ts   # or: npm run build-static-data
```

## Configuration

All tunable thresholds live in `src/config/constants.ts` — poll interval, search
radius, detection-machine gates and hysteresis (`DETECT_*`), glideslope math,
route-cache TTLs/backoff (`ROUTE_*`), auto-hide
delay, extended-centerline length, map styles, and AIRAC/NASR cycle constants.
User-adjustable values (poll interval, radius, centerline toggle/length, altitude
filter) live in `useSettingsStore` and persist to localStorage. Selected airport +
its ATIS also persist (`useAirportStore`).

## Testing

Vitest with `jsdom` + globals (`vitest.config.ts`). ~240 tests, unit tests
colocated in `__tests__/` folders under `geo/`, `utils/`, `api/`, `store/`, and
`services/`. There are no component/integration tests — the interpolation loop
and map layers are untested by design (the `api/` suites test parsing/caching
with a stubbed `fetch`). When changing ARINC parsing, altitude constraints,
AIRAC math, detection geometry/state-machine rules, ATIS parsing, or route
caching, add/adjust the matching unit test.

## TypeScript notes

- `moduleResolution: "node"` (not "bundler") — required for `@turf/turf` type resolution
- `allowSyntheticDefaultImports: true` — required for Fuse.js default import
- `strict: true`, `noUnusedLocals`, `noUnusedParameters` are on — dead code fails the build
- CSS module types declared in `src/vite-env.d.ts`
- Build splits vendor chunks (mapbox, turf, react-vendor) via `manualChunks` in `vite.config.ts`
