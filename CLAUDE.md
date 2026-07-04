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

- `VITE_MAPBOX_TOKEN` — Mapbox public token (account.mapbox.com, scopes: styles:read, tiles:read). Public by design; inlined into the client bundle.
- `ADSBX_API_KEY` — ADS-B Exchange supporter-tier API key. Deliberately **not** `VITE_`-prefixed: it must never enter the client bundle. In dev the Vite proxy attaches it as `X-RapidAPI-Key` server-side (`vite.config.ts`); in production it's a Static Web App application setting read by the Functions proxy (`api/src/functions/proxy.ts`).

The dATIS (atis.info), adsbdb route-lookup, aviationapi, and FAA (CIFP/d-TPP) APIs are keyless — no config needed.

## Dev

```sh
npm run dev              # Vite dev server on :5173 with dev-proxies (see below)
npm run test             # Vitest (55 unit tests) — watch mode
npm run test:ui          # Vitest UI
npm run build            # tsc -b && vite build (production)
npm run preview          # Preview a production build
npm run build-static-data # Regenerate public/data/*.json (see Data sources)
```

There is no ESLint/Prettier config in the repo; match the surrounding code style
(2-space indent, single quotes, no semicolons, CSS Modules per component).

## Deployment

Deploys to **Azure Static Web Apps (Free tier)** — static SPA + the six
`/api/*` proxy routes as SWA-managed Azure Functions (`api/` folder, Node 20).
GitHub Actions (`.github/workflows/azure-static-web-apps.yml`) deploys on push
to `main` and creates PR preview environments. Azure resources are defined in
`infra/main.bicep`, provisioned via `scripts/azure/*.sh`. See `DEPLOYMENT.md`
for the full setup (secrets, custom domain, limits, troubleshooting).

## Directory layout

```
src/
  api/           Thin fetch wrappers, one per upstream (adsbx, aviationApi, datis, opensky=adsbdb)
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
api/             Azure Functions proxy for production (mirrors the vite.config.ts dev proxies)
infra/           main.bicep — Azure resource definitions (Static Web App)
scripts/         buildStaticData.ts — regenerates public/data/*.json
scripts/azure/   az-cli scripts: provision, secrets, custom domain, teardown
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

**Dual procedure visibility model.** `src/store/useProcedureStore.ts` keeps `userToggles` (explicit user action) and `autoVisible` (detection engine) separate. `isVisible(id) = userToggles[id] ?? autoVisible[id] ?? false`. "Revert to auto" clears `userToggles[id]`. The store also tracks `lastDetectedAt`, `detectedHexes` (which aircraft matched each approach — powers hover highlighting), and `autoShownIds`.

**Procedure auto-detection.** `src/geo/procedureDetection.ts` runs after each ADS-B poll (via `src/hooks/useProcedureDetection.ts`). For each procedure with geometry it checks three gates: cross-track distance (0.5nm for SID/STAR, tighter 0.25nm for approaches so parallel runways disambiguate), altitude within tolerance of the interpolated expected altitude (250ft near the airport, 500ft far, 100ft on constrained/glideslope segments), and track-vs-procedure direction within 45° (rejects reciprocal-runway matches). Approaches are not detected for departing traffic, but a flown Missed segment is included if the plane flew the approach before the MAP. Auto-hides after 5 min (`AUTO_HIDE_DELAY_MS`) with no qualifying traffic.

**ATIS-driven approach preference.** `src/api/datis.ts` parses the dATIS text into per-runway approach-type preferences (e.g. "ILS OR LOC RWY 16L" → `{16L: ['I','L']}`) and departure runways. `useProcedureDetection` uses this to prefer the in-use approach type when multiple match; falls back to a static priority (`I > R > H > L`) when ATIS is unavailable. `useDatis` polls atis.info every 10 min.

**Route enrichment.** `src/hooks/useRouteEnrichment.ts` resolves airline callsigns (`^[A-Z]{3}\d`) to origin→destination via adsbdb (`src/api/opensky.ts`, keyless, session-cached). Results are validated against position — an aircraft more than 400nm off the origin→destination great-circle is rejected (stale data / callsign reuse).

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
| Callsign routes | adsbdb.com `/v0/callsign/...` | Proxied via `/api/adsbdb`, keyless, session-cached |
| Airport list | `public/data/airports.json` (88 major US airports) | Bundled; Fuse.js search |
| Runway geometry | `public/data/runways.json` (85 airports) | Loaded on airport select (`useRunways`) |

Dev proxies are defined in `vite.config.ts` (`/api/adsbx`, `/api/aviationapi`,
`/api/faa-cifp`, `/api/adsbdb`, `/api/datis`, `/api/dtpp`) to avoid CORS in the
browser. In production the same `/api/*` paths are served by the Azure
Functions catch-all proxy in `api/src/functions/proxy.ts` — when adding an
upstream, update **both** route tables.

To expand runway/airport coverage, run:

```sh
npm install -D unzipper   # if not installed
npx tsx scripts/buildStaticData.ts   # or: npm run build-static-data
```

## Configuration

All tunable thresholds live in `src/config/constants.ts` — poll interval, search
radius, cross-track/altitude/direction tolerances, glideslope math, auto-hide
delay, extended-centerline length, map styles, and AIRAC/NASR cycle constants.
User-adjustable values (poll interval, radius, centerline toggle/length, altitude
filter) live in `useSettingsStore` and persist to localStorage. Selected airport +
its ATIS also persist (`useAirportStore`).

## Testing

Vitest with `jsdom` + globals (`vitest.config.ts`). 55 tests, all pure-function
unit tests colocated in `__tests__/` folders under `geo/` and `utils/`. There are
no component/integration tests — the interpolation loop, map layers, and network
layer are untested by design. When changing ARINC parsing, altitude constraints,
AIRAC math, or detection geometry, add/adjust the matching unit test.

## TypeScript notes

- `moduleResolution: "node"` (not "bundler") — required for `@turf/turf` type resolution
- `allowSyntheticDefaultImports: true` — required for Fuse.js default import
- `strict: true`, `noUnusedLocals`, `noUnusedParameters` are on — dead code fails the build
- CSS module types declared in `src/vite-env.d.ts`
- Build splits vendor chunks (mapbox, turf, react-vendor) via `manualChunks` in `vite.config.ts`
