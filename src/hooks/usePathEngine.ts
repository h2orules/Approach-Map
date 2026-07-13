import { useEffect, useRef } from 'react'
import { useAircraftStore } from '../store/useAircraftStore'
import { useAirportStore, airportKey } from '../store/useAirportStore'
import { useProcedureStore } from '../store/useProcedureStore'
import { usePathStore } from '../store/usePathStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useMvaStore, ensureMvaLoaded } from '../services/mvaData'
import { recordPoll, getRecent } from '../services/trackLog'
import { prepareGuidance, predictPath, isOnProcedureNow, type Guidance } from '../geo/prediction'
import {
  collectHoldSpecs,
  reduceHoldEntries,
  emptyHoldEntryState,
  type HoldEntryState,
} from '../geo/holdEntry'
import { evaluateTrafficConflicts, alertsFromConflicts } from '../geo/conflicts'
import { scanTerrain } from '../geo/terrainScan'
import { elevationFtAt, prefetchAround } from '../services/terrainElevation'
import { warmKnownAirports, airportsNear } from '../services/knownAirports'
import { getRunwayInfoForAirport } from '../services/cifpCache'
import { alongTrackNm } from '../geo/profileMath'
import { positionToMinFt, positionToMaxFt } from '../utils/altitudeFilter'
import { VFR_SQUAWK } from '../config/constants'
import type { InterpolatedAircraft } from '../types/aircraft'
import type { Procedure } from '../types/procedure'
import type { PredictedPath, AircraftAlert, AlertTier } from '../types/path'
import type { MvaSector } from '../utils/aixmMva'

/** One active airport reduced to the fields every path-engine module consumes. */
interface AirportCtx {
  lat: number
  lon: number
  elevationFt: number
}

// Terrain-vs-traffic precedence when both fire on one aircraft: ra > warning >
// ta > alert. Traffic wins ties (a traffic alert of equal rank is kept).
const TIER_RANK: Record<AlertTier, number> = { ra: 4, warning: 3, ta: 2, alert: 1 }

// Radius (nm) around each active airport within which known airports are folded
// into the suppression/alert context. Comfortably covers a TRACON's worth of
// satellite fields so a KSEA arrival gets near-airport relief while only KPAE is
// active. Larger than any per-airport ADS-B search radius (50 nm).
const KNOWN_AIRPORT_CONTEXT_RADIUS_NM = 80

/**
 * The airport context for suppression/alerting: every active airport plus every
 * known airport within KNOWN_AIRPORT_CONTEXT_RADIUS_NM of one, deduped by rounded
 * position. This is what gives normal arrivals/departures at NON-active fields
 * near-airport terrain + traffic desensitization.
 */
function expandAirportContext(active: AirportCtx[]): AirportCtx[] {
  const byPos = new Map<string, AirportCtx>()
  const add = (a: AirportCtx) => {
    const key = `${a.lat.toFixed(3)},${a.lon.toFixed(3)}`
    if (!byPos.has(key)) byPos.set(key, a)
  }
  for (const a of active) add(a)
  for (const a of active) {
    for (const near of airportsNear(a.lat, a.lon, KNOWN_AIRPORT_CONTEXT_RADIUS_NM)) {
      add({ lat: near.lat, lon: near.lon, elevationFt: near.elevationFt })
    }
  }
  return Array.from(byPos.values())
}

/** Elevation (ft MSL) of the active airport nearest a point; 0 if none active. */
function nearestElevFt(airports: AirportCtx[], lat: number, lon: number): number {
  let best: AirportCtx | null = null
  let bestSq = Infinity
  for (const a of airports) {
    const dLat = a.lat - lat
    const dLon = a.lon - lon
    const sq = dLat * dLat + dLon * dLon
    if (sq < bestSq) {
      bestSq = sq
      best = a
    }
  }
  return best ? best.elevationFt : 0
}

/** Linear interpolation of the descent profile altitude at an along-track distance. */
function profileAltAtDist(points: { distNm: number; altFt: number }[], distNm: number): number {
  const n = points.length
  if (distNm <= points[0].distNm) return points[0].altFt
  const last = points[n - 1]
  if (distNm >= last.distNm) return last.altFt
  for (let i = 1; i < n; i++) {
    if (distNm <= points[i].distNm) {
      const a = points[i - 1]
      const b = points[i]
      const span = b.distNm - a.distNm
      const frac = span <= 0 ? 0 : (distNm - a.distNm) / span
      return a.altFt + (b.altFt - a.altFt) * frac
    }
  }
  return last.altFt
}

/**
 * |current altitude − expected profile altitude at the aircraft's current
 * along-track distance| for an aircraft established on an approach, or null
 * when there's no usable descent profile to compare against.
 */
function profileDeviationFt(ac: InterpolatedAircraft, guidance: Guidance): number | null {
  if (!guidance.transition || guidance.profilePoints.length < 2) return null
  if (ac.altBaro === 'ground') return null
  const along = alongTrackNm(guidance.transition, ac.interpLat, ac.interpLon).distNm
  const expected = profileAltAtDist(guidance.profilePoints, along)
  return Math.abs(ac.altBaro - expected)
}

/**
 * Per-poll path-prediction orchestrator: pure glue over the tested path modules.
 * Effect A runs once per ADS-B poll — records the tracklog, predicts every
 * airborne aircraft's path (following an assigned approach's guidance when
 * established, else turn/straight extrapolation), reduces hold-entry state,
 * evaluates traffic conflicts, scans terrain, and pushes one result batch into
 * usePathStore. All algorithms live in src/geo/* and src/services/*; this hook
 * only snapshots stores and wires the outputs together.
 */
export function usePathEngine() {
  const lastPollMs = useAircraftStore((s) => s.lastPollMs)
  const activeAirports = useAirportStore((s) => s.activeAirports)

  // Persist hold-entry lifecycle state across polls (pure reducer input/output).
  const holdStateRef = useRef<HoldEntryState>(emptyHoldEntryState())

  // ── Effect A: run the whole engine once per poll. ──────────────────────────
  useEffect(() => {
    if (lastPollMs === 0) return

    const aircraftMap = useAircraftStore.getState().aircraftMap
    recordPoll(aircraftMap, lastPollMs)

    const airports = useAirportStore.getState().activeAirports
    const airportCtx: AirportCtx[] = airports.map((a) => ({
      lat: a.lat,
      lon: a.lon,
      elevationFt: a.elevation,
    }))
    // Active airports ∪ nearby known airports — the near-airport relief context
    // used for terrain exclusion, low-AGL traffic suppression, and nearest-field
    // elevation lookups. Traffic near any known field (not just active ones) gets
    // desensitized so non-active-airport arrivals stop firing nuisance alerts.
    const suppressionAirports = expandAirportContext(airportCtx)
    // Field elevation per airport key (=== uppercase proc.icao), for approach guidance.
    const elevByKey: Record<string, number> = {}
    for (const a of airports) elevByKey[airportKey(a)] = a.elevation

    const airborne = Array.from(aircraftMap.values()).filter((ac) => ac.altBaro !== 'ground')

    // ── Hidden-aircraft set (mirrors AircraftOverlay's filter rules exactly). ─
    // The user's aircraft-overlay filters — TIS-B ('~' hex prefix) + showTisb,
    // VFR squawk (1200) + showVfr, and the altitude-range slider — hide targets
    // from the map. A hidden plane must not paint radar-tier conflict chrome or
    // terrain alerts (no warnings about planes you can't see), and its predicted
    // hold entry is just as invisible-context. These rules MUST stay in sync
    // with the `hidden` computation in src/components/map/AircraftOverlay.tsx.
    // TCAS TA/RA is the exception: it still evaluates across ALL aircraft below.
    const { altFilterMin, altFilterMax, showTisb, showVfr } = useSettingsStore.getState()
    const minFt = positionToMinFt(altFilterMin)
    const maxFt = positionToMaxFt(altFilterMax)
    const hiddenHexes = new Set<string>()
    for (const ac of airborne) {
      const alt = ac.altBaro as number
      if (
        alt < minFt ||
        alt > maxFt ||
        (!showTisb && ac.hex.startsWith('~')) ||
        (!showVfr && ac.squawk === VFR_SQUAWK)
      ) {
        hiddenHexes.add(ac.hex)
      }
    }

    const procedures = useProcedureStore.getState().procedures
    const assignments = useProcedureStore.getState().aircraftAssignments
    const procById = new Map(procedures.map((p) => [p.id, p]))

    // Guidance is WeakMap-cached per procedure, but the runway lookup that feeds
    // it isn't — memoize per procedure id for this poll so N aircraft on one
    // approach don't each redo the RW lookup.
    const guidanceByProcId = new Map<string, Guidance>()
    const guidanceFor = (proc: Procedure): Guidance => {
      const cached = guidanceByProcId.get(proc.id)
      if (cached) return cached
      const rwyInfo = getRunwayInfoForAirport(proc.icao)
      const ident = proc.runways[0]
      const rwy = ident ? rwyInfo[`RW${ident}`] ?? null : null
      const fieldElevFt = elevByKey[proc.icao.toUpperCase()] ?? 0
      const g = prepareGuidance(proc, rwy, fieldElevFt)
      guidanceByProcId.set(proc.id, g)
      return g
    }

    // ── Predictions for every airborne aircraft. ─────────────────────────────
    const predictions = new Map<string, PredictedPath>()
    const acByHex = new Map<string, InterpolatedAircraft>()
    // Per-aircraft approach guidance kept for the terrain pass (null = unassigned).
    const guidanceByHex = new Map<string, Guidance>()
    for (const ac of airborne) {
      acByHex.set(ac.hex, ac)
      const proc = assignments[ac.hex] ? procById.get(assignments[ac.hex]) : undefined
      const recent = getRecent(ac.hex, 3)
      if (proc) {
        const guidance = guidanceFor(proc)
        guidanceByHex.set(ac.hex, guidance)
        // predictPath itself calls isOnProcedureNow(ac, proc) to decide whether
        // to follow the guidance or fall back to turn-mode, so we just hand it
        // the guidance and the field elevation.
        const fieldElevFt = elevByKey[proc.icao.toUpperCase()] ?? nearestElevFt(suppressionAirports, ac.interpLat, ac.interpLon)
        predictions.set(ac.hex, predictPath(ac, recent, guidance, fieldElevFt))
      } else {
        const fieldElevFt = nearestElevFt(suppressionAirports, ac.interpLat, ac.interpLon)
        predictions.set(ac.hex, predictPath(ac, recent, null, fieldElevFt))
      }
    }

    // ── Hold entries (VFR, TIS-B, and filter-hidden traffic excluded). ───────
    // VFR squawk carries no filed hold; a TIS-B target's forced-straight
    // prediction makes an entry classification meaningless; and a filter-hidden
    // plane's predicted entry is invisible context like its alerts.
    const specs = collectHoldSpecs(procedures)
    const holdInput = {
      nowMs: lastPollMs,
      aircraft: airborne.filter(
        (ac) => ac.squawk !== VFR_SQUAWK && !ac.hex.startsWith('~') && !hiddenHexes.has(ac.hex),
      ),
      predictions,
      specs,
      assignments,
    }
    const holdState = reduceHoldEntries(holdStateRef.current, holdInput)
    holdStateRef.current = holdState

    // Per-aircraft "established on an approach" state — assigned to a procedure
    // AND currently on-course per isOnProcedureNow (the same test predictPath
    // uses to decide whether to follow guidance). Shared by the radar-tier
    // traffic-conflict inhibit right below and the terrain onApproach flag
    // further down, computed once per aircraft so isOnProcedureNow never runs
    // twice for the same hex in one poll.
    const onApproachHexes = new Set<string>()
    for (const ac of airborne) {
      const proc = guidanceByHex.get(ac.hex)?.proc
      if (proc !== undefined && isOnProcedureNow(ac, proc)) onApproachHexes.add(ac.hex)
    }

    // ── Traffic conflicts → per-aircraft alerts. ─────────────────────────────
    // TCAS TA/RA evaluates across ALL airborne aircraft (the stringent tier).
    // Filter-aware post-pass: keep every TA/RA pair, but drop radar-tier
    // ('alert'/'warning') pairs where EITHER member is filter-hidden — no
    // radar conflict chrome about a plane the user can't see. Also mirrors
    // real STARS Conflict Alert's approach-context inhibit: CA is suppressed
    // between aircraft established on an approach, since parallel-final and
    // in-trail spacing there is intentional, ATC-separated geometry, not a
    // conflict — so drop a radar-tier pair when BOTH members are established.
    // TCAS TA/RA is exempt from both inhibits: real TCAS runs through final
    // approach too, and its own tau/DMOD/ZTHR gating plus low-AGL sensitivity
    // levels already account for approach geometry.
    const allPairs = evaluateTrafficConflicts(predictions, acByHex, { airports: suppressionAirports })
    const conflictPairs = allPairs.filter((p) => {
      if (p.tier === 'ta' || p.tier === 'ra') return true
      if (hiddenHexes.has(p.hexA) || hiddenHexes.has(p.hexB)) return false
      if (onApproachHexes.has(p.hexA) && onApproachHexes.has(p.hexB)) return false
      return true
    })
    const alerts = alertsFromConflicts(conflictPairs)

    // Force-show any otherwise-hidden aircraft caught in a surviving TA/RA so
    // the overlay reveals the target the TCAS alert is about (only planes that
    // would actually be hidden need forcing; visible ones render already).
    const forcedVisibleHexes = new Set<string>()
    for (const p of conflictPairs) {
      if (p.tier !== 'ta' && p.tier !== 'ra') continue
      if (hiddenHexes.has(p.hexA)) forcedVisibleHexes.add(p.hexA)
      if (hiddenHexes.has(p.hexB)) forcedVisibleHexes.add(p.hexB)
    }

    // ── Terrain scan per airborne aircraft. ──────────────────────────────────
    // Terrain alerting always runs (independent of the showMva display toggle);
    // MVA sectors are loaded on airport change in Effect B below.
    const mvaByIcao = useMvaStore.getState().byIcao
    const sectors: MvaSector[] = []
    for (const a of airports) {
      const s = mvaByIcao[airportKey(a)]
      if (s) sectors.push(...s)
    }
    for (const ac of airborne) {
      // FAA MSAW processing is inhibited for VFR (1200) beacon codes — a
      // floatplane or helicopter legitimately working at 600–1700 ft below an
      // MVA floor is not a terrain conflict. TIS-B targets (ADS-B Exchange
      // prefixes their hex with '~') carry coarse, often-stale positions that
      // make the predicted path meaningless for terrain purposes — skip both.
      // Also skip anything the user has filter-hidden: no terrain warning about
      // a plane that isn't on the map.
      if (ac.squawk === VFR_SQUAWK || ac.hex.startsWith('~') || hiddenHexes.has(ac.hex)) continue
      const pred = predictions.get(ac.hex)
      if (!pred) continue
      const guidance = guidanceByHex.get(ac.hex)
      const onApproach = onApproachHexes.has(ac.hex)
      const deviationFt = onApproach && guidance ? profileDeviationFt(ac, guidance) : null
      // Actual ground elevation under the aircraft's CURRENT position, for the
      // TAWS-style landing-config inhibit — falls back to the nearest known
      // airport's elevation when the DEM tile is cold (never leaves AGL
      // unresolved due to a transient cache miss).
      const groundElevFt =
        elevationFtAt(ac.interpLat, ac.interpLon) ?? nearestElevFt(suppressionAirports, ac.interpLat, ac.interpLon)
      const currentAglFt = ac.altBaro === 'ground' ? null : ac.altBaro - groundElevFt
      const tier = scanTerrain(pred, sectors, elevationFtAt, {
        onApproach,
        profileDeviationFt: deviationFt,
        airports: suppressionAirports,
        gsKt: ac.groundspeed,
        currentAglFt,
      })
      if (!tier) continue
      // Only surface a terrain alert if no traffic alert of equal-or-worse tier
      // already owns this aircraft (traffic wins ties).
      const existing = alerts.get(ac.hex)
      if (existing && TIER_RANK[existing.tier] >= TIER_RANK[tier]) continue
      const terrainAlert: AircraftAlert = { kind: 'terrain', tier }
      alerts.set(ac.hex, terrainAlert)
    }

    usePathStore.getState().setResults({
      predictions,
      holdEntries: holdState.entries,
      alerts,
      conflictPairs,
      forcedVisibleHexes,
    })
  }, [lastPollMs])

  // ── Effect B: load MVA + warm terrain tiles when active airports change. ───
  // Terrain alerting needs MVA sectors regardless of the showMva display toggle,
  // so load them here off the display path.
  useEffect(() => {
    // Warm the known-airports list (idempotent) so near-airport relief can apply
    // around non-active fields, not just the airports the user made active.
    warmKnownAirports()
    for (const a of activeAirports) void ensureMvaLoaded(airportKey(a))
    prefetchAround(activeAirports.map((a) => ({ lat: a.lat, lon: a.lon })))
  }, [activeAirports])
}
