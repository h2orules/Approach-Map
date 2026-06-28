# Approach Map

A localhost web app that visualizes live ADS-B aircraft positions relative to published FAA instrument procedures (SIDs, STARs, Approaches) at US airports. Think TRACON radar display with modern styling.

## Stack

- **React 18 + TypeScript + Vite** — no Next.js, plain Vite SPA
- **react-map-gl v7 + mapbox-gl v2** — v7 to avoid Mapbox v3 license complexity
- **Zustand** for state; **TanStack Query v5** for data fetching
- **@turf/turf v6** for geo math (cross-track distance, dead-reckoning)
- **Fuse.js** for fuzzy airport search over bundled `public/data/airports.json`
- **fflate** for ZIP extraction (CIFP download is a ZIP, not gzip)

## Required environment variables

Copy `.env.example` to `.env.local` and fill in:

- `VITE_MAPBOX_TOKEN` — Mapbox public token (account.mapbox.com, scopes: styles:read, tiles:read)
- `VITE_ADSBX_API_KEY` — ADS-B Exchange supporter-tier API key

## Dev

```sh
npm run dev      # Vite dev server on :5173 with proxy for ADS-B, aviationapi, FAA CIFP
npm run test     # Vitest (28 unit tests)
npm run build    # Production build
```

## Key architecture decisions

**Aircraft at 60fps without React re-renders.** `src/hooks/useAircraftInterpolation.ts` runs a `requestAnimationFrame` loop, dead-reckons positions via `turf.destination()`, and calls `mapboxSource.setData()` directly — bypassing React entirely. React only re-renders AircraftLayer when the aircraft _set_ changes.

**CIFP uses AIRAC-cycle-aware IndexedDB caching.** The FAA CIFP file (~9MB zip) follows the 28-day AIRAC cycle. `src/services/cifpCache.ts` downloads, parses (in a Web Worker), and stores in IndexedDB with the cycle effective date. A `setTimeout` fires at the exact next-cycle boundary to refresh. A `visibilitychange` listener handles tabs backgrounded across a boundary. Reference: `src/utils/airac.ts` for cycle math.

CIFP file facts (verified against live FAA data, June 2026):

- Zip URL is `CIFP_YYMMDD.zip` (6-digit date, e.g. `CIFP_260611.zip`), AIRAC reference `2024-01-25`.
- The ARINC 424 data file inside is named `FAACIFP18` (no extension), alongside PDFs/xlsx.
- Airport-section records (`P`): section code at col 5, ICAO at cols 7–10, **subsection at col 13** (`D`=SID, `E`=STAR, `F`=Approach, `C`=terminal waypoint). Enroute (`E`) and navaid (`D`) records put subsection at col 6 instead.
- SID/STAR/approach legs carry NO embedded lat/lon — fix coordinates are looked up by name from terminal-waypoint (`PC`) and enroute (`EA`) records (lat at cols 33–41, lon 42–51).
- Each procedure has multiple transitions (runway + enroute) that restart sequence numbers; the parser keys waypoints by transition to avoid collisions and draws one line per transition.

**Dual procedure visibility model.** `src/store/useProcedureStore.ts` keeps `userToggles` (explicit user action) and `autoVisible` (detection engine) separate. `isVisible(id) = userToggles[id] ?? autoVisible[id] ?? false`. "Revert to auto" clears `userToggles[id]`.

**Procedure auto-detection.** `src/geo/procedureDetection.ts` runs after each ADS-B poll. For each procedure with geometry, checks: cross-track ≤ 0.5nm AND altitude within 500ft of expected (250ft within 5nm of airport). Auto-hides after 5 min with no qualifying traffic.

## Data sources

| Data | Source | How loaded |
| --- | --- | --- |
| Live aircraft | ADS-B Exchange `/api/aircraft/v2/lat/.../lon/.../dist/` | Proxied via `/api/adsbx`, polled via TanStack Query |
| Procedure names | aviationapi.com `/api/v1/charts?apt=ICAO` | Proxied via `/api/aviationapi` |
| Procedure geometry | FAA CIFP (ARINC 424, 28-day AIRAC cycle) | Proxied via `/api/faa-cifp`, cached in IndexedDB |
| Airport list | `public/data/airports.json` (~90 major US airports) | Bundled; Fuse.js search |
| Runway geometry | `public/data/runways.json` (9 airports with accurate data) | Loaded on airport select |

To expand runway/airport coverage, run:

```sh
npm install -D unzipper   # if not installed
npx tsx scripts/buildStaticData.ts
```

## TypeScript notes

- `moduleResolution: "node"` (not "bundler") — required for `@turf/turf` type resolution
- `allowSyntheticDefaultImports: true` — required for Fuse.js default import
- CSS module types declared in `src/vite-env.d.ts`
