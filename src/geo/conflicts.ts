import {
  CONFLICT_HORIZON_S,
  CONFLICT_PREFILTER_NM,
  CONFLICT_PREFILTER_DALT_FT,
  FORMATION_SUPPRESS_DALT_FT,
  FORMATION_SUPPRESS_GS_KT,
  FORMATION_SUPPRESS_NM,
  FORMATION_SUPPRESS_TRK_DEG,
  TISB_SHADOW_DALT_FT,
  TISB_SHADOW_GS_KT,
  TISB_SHADOW_NM,
  TISB_SHADOW_TRK_DEG,
  RADAR_ALERT_SEP_NM,
  RADAR_ALERT_DALT_FT,
  RADAR_ALERT_HORIZON_S,
  RADAR_WARN_SEP_NM,
  RADAR_WARN_DALT_FT,
  RADAR_WARN_HORIZON_S,
  RADAR_MIN_CLOSURE_NM,
  RA_ESCAPE_FPM,
  RA_RESPONSE_DELAY_S,
  TRAFFIC_SUPPRESS_AGL_FT,
  TRAFFIC_SUPPRESS_AIRPORT_NM,
  VFR_SQUAWK,
} from '../config/constants'
import { bearingDelta } from './lineMatching'
import { sensitivityLevelFor, type TcasSL } from './tcasTables'
import type { AircraftAlert, AlertTier, ConflictPair, PredictedPath, RaSense } from '../types/path'
import type { InterpolatedAircraft } from '../types/aircraft'

const DEG2RAD = Math.PI / 180
// Predicted-path sample spacing (matches the path predictor's 5 s grid).
const PRED_STEP_S = 5
// Prefilter: a pair >CONFLICT_PREFILTER_DALT_FT apart vertically is only kept
// when the gap is closing at least this fast (aggressive climb/descent).
const PREFILTER_MIN_VCLOSE_FPM = 2000

export interface ConflictContext {
  airports: { lat: number; lon: number; elevationFt: number }[]
}

/** Equirectangular horizontal distance in nm (1° lat = 60 nm, cos-lat scaled lon). */
function equirectNm(lat1: number, lon1: number, lat2: number, lon2: number, cosLat?: number): number {
  const c = cosLat ?? Math.cos(((lat1 + lat2) / 2) * DEG2RAD)
  const dxNm = (lon2 - lon1) * 60 * c
  const dyNm = (lat2 - lat1) * 60
  return Math.sqrt(dxNm * dxNm + dyNm * dyNm)
}

interface NearestAirport {
  distNm: number
  elevationFt: number
}

function nearestAirport(lat: number, lon: number, ctx: ConflictContext): NearestAirport | null {
  let best: NearestAirport | null = null
  for (const ap of ctx.airports) {
    const distNm = equirectNm(lat, lon, ap.lat, ap.lon)
    if (!best || distNm < best.distNm) best = { distNm, elevationFt: ap.elevationFt }
  }
  return best
}

/**
 * Rate (ft/min, >= 0) at which the vertical gap between two aircraft is
 * shrinking right now; 0 when the gap is flat, widening, or already zero.
 */
function verticalClosingRateFpm(altA0: number, altB0: number, rateA: number, rateB: number): number {
  const gap = altA0 - altB0
  if (gap === 0) return 0
  const gapRateFpm = rateA - rateB // rate of change of (altA − altB)
  const closing = gap > 0 ? -gapRateFpm : gapRateFpm
  return closing > 0 ? closing : 0
}

/**
 * One aircraft's altitude `atS` seconds from now under an RA escape maneuver:
 * it keeps its current vertical rate through the pilot-response delay, then
 * switches instantly to `escapeFpm` (signed — negative for a descend sense).
 */
function simulateAlt(alt0: number, currentRateFpm: number, escapeFpm: number, atS: number): number {
  if (atS <= RA_RESPONSE_DELAY_S) return alt0 + (currentRateFpm / 60) * atS
  const altAtDelay = alt0 + (currentRateFpm / 60) * RA_RESPONSE_DELAY_S
  return altAtDelay + (escapeFpm / 60) * (atS - RA_RESPONSE_DELAY_S)
}

/**
 * Pairwise traffic-conflict evaluation over predicted paths, run once per
 * ADS-B poll. Two tiers share one pass: a TCAS II model (TA/RA per the
 * DO-185B sensitivity levels in src/geo/tcasTables.ts, with an RA
 * climb/descend sense chosen by simulating both escape senses to CPA) and an
 * ATC-radar-style separation model (RADAR_* thresholds). One ConflictPair is
 * emitted per conflicting pair with the winning tier
 * (ra > warning > ta > alert).
 */
export function evaluateTrafficConflicts(
  predictions: ReadonlyMap<string, PredictedPath>,
  acByHex: ReadonlyMap<string, InterpolatedAircraft>,
  ctx: ConflictContext,
): ConflictPair[] {
  // Airborne aircraft that have a predicted path, in prediction order.
  const hexes: string[] = []
  for (const [hex, path] of predictions) {
    const ac = acByHex.get(hex)
    if (ac && ac.altBaro !== 'ground' && path.points.length > 0) hexes.push(hex)
  }

  const horizonSteps = Math.floor(CONFLICT_HORIZON_S / PRED_STEP_S) + 1 // includes t=0
  const pairs: ConflictPair[] = []

  for (let i = 0; i < hexes.length; i++) {
    for (let j = i + 1; j < hexes.length; j++) {
      const hexA = hexes[i]
      const hexB = hexes[j]
      const acA = acByHex.get(hexA)!
      const acB = acByHex.get(hexB)!
      const ptsA = predictions.get(hexA)!.points
      const ptsB = predictions.get(hexB)!.points

      const a0 = ptsA[0]
      const b0 = ptsB[0]
      const altA0 = a0.altFt
      const altB0 = b0.altFt

      // ── Cheap prefilter (no turf) ────────────────────────────────────────
      const dist0 = equirectNm(a0.lat, a0.lon, b0.lat, b0.lon)
      if (dist0 > CONFLICT_PREFILTER_NM) continue
      const dAlt0 = Math.abs(altA0 - altB0)
      const vCloseFpm = verticalClosingRateFpm(altA0, altB0, acA.baroRate, acB.baroRate)
      if (dAlt0 > CONFLICT_PREFILTER_DALT_FT && vCloseFpm < PREFILTER_MIN_VCLOSE_FPM) continue

      // ── Low-AGL near-airport suppression (pattern/parallel-runway noise) ─
      const nearA = nearestAirport(a0.lat, a0.lon, ctx)
      const nearB = nearestAirport(b0.lat, b0.lon, ctx)
      const aglA = nearA ? altA0 - nearA.elevationFt : Infinity
      const aglB = nearB ? altB0 - nearB.elevationFt : Infinity
      if (
        nearA !== null &&
        nearB !== null &&
        aglA < TRAFFIC_SUPPRESS_AGL_FT &&
        aglB < TRAFFIC_SUPPRESS_AGL_FT &&
        nearA.distNm <= TRAFFIC_SUPPRESS_AIRPORT_NM &&
        nearB.distNm <= TRAFFIC_SUPPRESS_AIRPORT_NM
      ) {
        continue
      }

      // ── Formation / duplicate-track suppression ──────────────────────────
      // A pair sustaining near-identical position, altitude, track, and speed
      // is intentional formation flying, or two ADS-B/TIS-B tracks of one
      // airframe (duplicate reception) — not a conflict. Matched velocity
      // means zero closure, so skipping the pair loses nothing. Applies to
      // BOTH the TCAS and radar tiers below — the whole pair is skipped.
      if (
        dist0 < FORMATION_SUPPRESS_NM &&
        dAlt0 < FORMATION_SUPPRESS_DALT_FT &&
        bearingDelta(acA.track, acB.track) < FORMATION_SUPPRESS_TRK_DEG &&
        Math.abs(acA.groundspeed - acB.groundspeed) < FORMATION_SUPPRESS_GS_KT
      ) {
        continue
      }

      // ── Same-airframe dedupe ──────────────────────────────────────────────
      // Two tracks reporting the same registration or the same callsign are
      // duplicate receptions of a single airplane — never a real conflict,
      // regardless of the geometry between them.
      if (
        (acA.registration && acB.registration && acA.registration === acB.registration) ||
        (acA.flight && acB.flight && acA.flight === acB.flight)
      ) {
        continue
      }

      // ── TIS-B shadow suppression ──────────────────────────────────────────
      // A TIS-B pseudo-track (hex starting '~') co-moving with the other
      // member of the pair at wider-than-formation tolerances is a rebroadcast
      // shadow of the same airframe's radar trackfile (or of a nearby
      // aircraft's), not independent traffic — TIS-B can be tens of seconds
      // stale, so the shadow trails well beyond FORMATION_SUPPRESS_NM on an
      // otherwise matched course. Matched velocity again means zero closure,
      // so nothing genuine is lost by skipping the pair.
      if (
        (hexA.startsWith('~') || hexB.startsWith('~')) &&
        dist0 < TISB_SHADOW_NM &&
        dAlt0 < TISB_SHADOW_DALT_FT &&
        bearingDelta(acA.track, acB.track) < TISB_SHADOW_TRK_DEG &&
        Math.abs(acA.groundspeed - acB.groundspeed) < TISB_SHADOW_GS_KT
      ) {
        continue
      }

      // ── Shared sample grid: t = 0, 5, …, CONFLICT_HORIZON_S ─────────────
      const n = Math.min(ptsA.length, ptsB.length, horizonSteps)
      const cosLat = Math.cos(((a0.lat + b0.lat) / 2) * DEG2RAD)
      const rangeAt = (k: number) => equirectNm(ptsA[k].lat, ptsA[k].lon, ptsB[k].lat, ptsB[k].lon, cosLat)
      const dAltAt = (k: number) => Math.abs(ptsA[k].altFt - ptsB[k].altFt)

      // CPA: min horizontal range over the grid, earliest sample on ties.
      let cpaIdx = 0
      let cpaNm = rangeAt(0)
      for (let k = 1; k < n; k++) {
        const r = rangeAt(k)
        if (r < cpaNm) {
          cpaNm = r
          cpaIdx = k
        }
      }
      const cpaTimeS = ptsA[cpaIdx].tSec
      const cpaDAltFt = dAltAt(cpaIdx)

      // ── Range tau from the first prediction step ─────────────────────────
      const range0 = rangeAt(0)
      const closureKt = n > 1 ? ((range0 - rangeAt(1)) / PRED_STEP_S) * 3600 : 0
      const tauS = closureKt > 0 ? (range0 / closureKt) * 3600 : Infinity
      // Vertical tau analog: time to co-altitude at the current closing rate.
      const verticalTauS = vCloseFpm > 0 ? dAlt0 / (vCloseFpm / 60) : Infinity

      // ── Sensitivity level: the more sensitive (higher-row) of the pair ──
      const slA = sensitivityLevelFor(altA0, aglA)
      const slB = sensitivityLevelFor(altB0, aglB)
      const sl: TcasSL = slA.sl >= slB.sl ? slA : slB

      const taFires =
        (tauS <= sl.taTauS && (cpaDAltFt <= sl.taZthrFt || verticalTauS <= sl.taTauS)) ||
        (range0 <= sl.taDmodNm && dAlt0 <= sl.taZthrFt)

      const raFires =
        sl.raTauS !== null &&
        sl.raDmodNm !== null &&
        sl.raZthrFt !== null &&
        ((tauS <= sl.raTauS && (cpaDAltFt <= sl.raZthrFt || verticalTauS <= sl.raTauS)) ||
          (range0 <= sl.raDmodNm && dAlt0 <= sl.raZthrFt))

      // ── Radar-style tier over the sample grid ────────────────────────────
      // The radar tier is a *convergence* alert ("path WILL intersect the
      // threshold within the horizon"): a qualifying sample inside the window
      // alerts only if the pair is actually closing into it — it either closes
      // at least RADAR_MIN_CLOSURE_NM versus t=0, or enters the window from
      // outside (t=0 separation already beyond the lateral threshold). Stable
      // parallel-approach / in-trail / formation pairs sitting at constant
      // separation already inside the window never latch a radar alert.
      //
      // VFR-vs-VFR inhibit: STARS Conflict Alert is inhibited for pairs where
      // both aircraft squawk VFR (1200) — controllers don't separate VFRs, and
      // flight-school pairs working in/near the pattern would otherwise paint
      // the map with nuisance radar tiers. At least one aircraft must carry a
      // discrete (non-VFR) code for the radar tier to apply. The TCAS TA/RA
      // tier is deliberately untouched — real TCAS doesn't read squawks, and
      // its tau gate keeps stable VFR pairs quiet on its own.
      let radarAlert = false
      let radarWarn = false
      const radarEligible = acA.squawk !== VFR_SQUAWK || acB.squawk !== VFR_SQUAWK
      for (let k = 0; radarEligible && k < n && ptsA[k].tSec <= RADAR_ALERT_HORIZON_S; k++) {
        const sep = rangeAt(k)
        const dAlt = dAltAt(k)
        if (sep <= RADAR_ALERT_SEP_NM && dAlt <= RADAR_ALERT_DALT_FT) {
          if (sep <= range0 - RADAR_MIN_CLOSURE_NM || range0 > RADAR_ALERT_SEP_NM) radarAlert = true
        }
        if (ptsA[k].tSec <= RADAR_WARN_HORIZON_S && sep <= RADAR_WARN_SEP_NM && dAlt <= RADAR_WARN_DALT_FT) {
          if (sep <= range0 - RADAR_MIN_CLOSURE_NM || range0 > RADAR_WARN_SEP_NM) radarWarn = true
        }
      }

      // ── Tier precedence: ra > warning > ta > alert ───────────────────────
      let tier: AlertTier | null = null
      if (raFires) tier = 'ra'
      else if (radarWarn) tier = 'warning'
      else if (taFires) tier = 'ta'
      else if (radarAlert) tier = 'alert'
      if (tier === null) continue

      // ── RA sense: simulate both escape senses to CPA ─────────────────────
      let raSenseA: RaSense | undefined
      let raSenseB: RaSense | undefined
      if (tier === 'ra' && sl.alimFt !== null) {
        const sepAClimb = Math.abs(
          simulateAlt(altA0, acA.baroRate, RA_ESCAPE_FPM, cpaTimeS) -
            simulateAlt(altB0, acB.baroRate, -RA_ESCAPE_FPM, cpaTimeS),
        )
        const sepADescend = Math.abs(
          simulateAlt(altA0, acA.baroRate, -RA_ESCAPE_FPM, cpaTimeS) -
            simulateAlt(altB0, acB.baroRate, RA_ESCAPE_FPM, cpaTimeS),
        )
        // Which aircraft is projected higher at CPA with no escape maneuver.
        const aHigherAtCpa =
          altA0 + (acA.baroRate / 60) * cpaTimeS >= altB0 + (acB.baroRate / 60) * cpaTimeS
        const preferredSep = aHigherAtCpa ? sepAClimb : sepADescend
        const otherSep = aHigherAtCpa ? sepADescend : sepAClimb
        // Prefer "higher aircraft climbs" when it achieves ALIM; else the
        // crossing sense if IT achieves ALIM; else whichever separates more.
        let aClimbs: boolean
        if (preferredSep >= sl.alimFt) aClimbs = aHigherAtCpa
        else if (otherSep >= sl.alimFt) aClimbs = !aHigherAtCpa
        else aClimbs = sepAClimb >= sepADescend
        raSenseA = aClimbs ? 'climb' : 'descend'
        raSenseB = aClimbs ? 'descend' : 'climb'
      }

      pairs.push({
        hexA,
        hexB,
        tier,
        ...(raSenseA ? { raSenseA } : {}),
        ...(raSenseB ? { raSenseB } : {}),
        cpaTimeS,
        cpaNm,
        cpaDAltFt,
      })
    }
  }

  return pairs
}

const TIER_RANK: Record<AlertTier, number> = { ra: 4, warning: 3, ta: 2, alert: 1 }

/** Collapses conflict pairs to the single worst traffic alert per aircraft. */
export function alertsFromConflicts(pairs: ConflictPair[]): Map<string, AircraftAlert> {
  const alerts = new Map<string, AircraftAlert>()
  const consider = (hex: string, otherHex: string, tier: AlertTier, raSense: RaSense | undefined) => {
    const existing = alerts.get(hex)
    if (existing && TIER_RANK[existing.tier] >= TIER_RANK[tier]) return
    alerts.set(hex, {
      kind: 'traffic',
      tier,
      otherHex,
      ...(tier === 'ra' && raSense ? { raSense } : {}),
    })
  }
  for (const p of pairs) {
    consider(p.hexA, p.hexB, p.tier, p.raSenseA)
    consider(p.hexB, p.hexA, p.tier, p.raSenseB)
  }
  return alerts
}
