import type { Procedure, ProcedureWaypoint, ProcedureLeg, ProcedureTransition, NavaidType, ProcedureType, WaypointRole, WaypointSymbol } from '../types/procedure'
import type { CifpAirportData, CifpRunwayInfo } from '../types/cifp'
import { parseArinc424AltDescriptor } from '../utils/altitudeConstraint'
import { nextProcedureColor, resetColorCounters } from '../utils/colorScheme'
import { parseLatLon } from '../utils/arincCoords'
import {
  parseAirportMagVar,
  parseRunwayExtras,
  parseIlsGsFields,
  parsePathPointRecord,
  parseMsaRecord,
  parseTaaRecord,
  buildSafeAltitudeAreas,
  magneticToTrue,
  type MsaRawRecord,
  type TaaRawRecord,
  type IlsGsFields,
} from '../utils/arincRecords'
import {
  parseProcRecord,
  legRole,
  parseLegLen,
  parseVertAngleDeg,
  derivePi,
  computeNoPtTransitionIds,
  deriveVdaGpaDeg,
  deriveCourseReversal,
  deriveHoldInLieu,
} from './cifpParseCore'
import { holdTrack, procedureTurn } from '../geo/procedureShapes'

/**
 * Progress callback invoked as the parse proceeds. The CIFP worker forwards
 * these to `postMessage`; the build scripts use them for console logging (or
 * ignore them). Pure and side-effect-free otherwise, so this module runs
 * unchanged in a Web Worker or under tsx/node.
 */
export type CifpParseProgress = (percent: number, message: string) => void

interface WaypointRecord {
  lat: number
  lon: number
  navaidType: NavaidType
}

// One parsed leg of a transition is the exported `ProcedureLeg` (shape-identical
// to the former internal `Leg`), so transitions can be surfaced on the Procedure.
// The pure per-line parsers/derivations live in ./cifpParseCore for testability.

function classifyProcedure(subSection: string): ProcedureType | null {
  if (subSection === 'D') return 'SID'
  if (subSection === 'E') return 'STAR'
  if (subSection === 'F') return 'APPROACH'
  return null
}

type Coord = [number, number]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFeature = any

function lineFeature(coords: Coord[], props: Record<string, unknown>): AnyFeature {
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: props }
}

/**
 * Build all renderable line features for a procedure from its transitions.
 * Each transition's legs are split at the missed-approach point (MAP): legs up
 * to and including the MAP are the inbound path (solid); legs after it are the
 * missed approach (dash-dot). Holds (HM/HF/HA) and procedure turns (PI) are
 * emitted as their own racetrack/barb features tagged with the same segment.
 * Every feature gets a `transitionId` property so the renderer can style
 * opposite-direction SID runway transitions as dotted lines.
 */
/** How close (nm) a procedure-turn fix must be to the final FAF to anchor the
 *  drawn PT onto the final path (matches the LOM collocation radius). */
const PT_FAF_COLLOCATE_NM = 0.5

function buildProcedureFeatures(
  transitions: Array<{ id: string; legs: ProcedureLeg[] }>,
  magVarDeg: number | null,
): AnyFeature[] {
  const features: AnyFeature[] = []

  // Final-approach FAF (a `faf` leg on the transition that also reaches the MAP)
  // — the on-path fix a collocated procedure turn is anchored to so its outbound
  // leg lies exactly along the drawn final course rather than the (possibly
  // slightly offset) NDB/PI fix.
  let fafFix: { lat: number; lon: number } | null = null
  for (const { legs } of transitions) {
    const faf = legs.find((l) => l.role === 'faf')
    if (faf && legs.some((l) => l.role === 'map')) {
      fafFix = { lat: faf.lat, lon: faf.lon }
      break
    }
  }

  // A missed-approach hold (HM) that coincides with a hold-in-lieu (HF) on a
  // transition segment — same fix, course, and turn — is the same charted
  // racetrack (e.g. KAWO R34: HILPT at SAVOY, missed approach holds at SAVOY).
  // Emit only the solid transition-segment one; a second dash-dot copy on top
  // just muddies the line.
  const holdKey = (l: ProcedureLeg) => `${l.fixId}:${Math.round(l.course * 10)}:${l.turnRight ? 'R' : 'L'}`
  const transitionHoldKeys = new Set<string>()
  for (const { legs } of transitions) {
    const mapIdx = legs.findIndex((l) => l.role === 'map')
    legs.forEach((l, i) => {
      const isHold = l.pathTerm === 'HM' || l.pathTerm === 'HF' || l.pathTerm === 'HA'
      if (isHold && !(mapIdx >= 0 && i > mapIdx)) transitionHoldKeys.add(holdKey(l))
    })
  }

  for (const { id: transitionId, legs } of transitions) {
    const mapIdx = legs.findIndex((l) => l.role === 'map')
    const inboundEnd = mapIdx >= 0 ? mapIdx + 1 : legs.length

    const inbound = legs.slice(0, inboundEnd)
    const missed = mapIdx >= 0 ? legs.slice(mapIdx) : [] // start missed at the MAP for continuity

    if (inbound.length >= 2) {
      features.push(lineFeature(inbound.map((l) => [l.lon, l.lat]), { kind: 'path', segment: 'transition', transitionId }))
    }
    if (missed.length >= 2) {
      features.push(lineFeature(missed.map((l) => [l.lon, l.lat]), { kind: 'path', segment: 'missed', transitionId }))
    }

    // Holds and procedure turns as their own shapes
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i]
      const segment = mapIdx >= 0 && i > mapIdx ? 'missed' : 'transition'
      if (l.pathTerm === 'HM' || l.pathTerm === 'HF' || l.pathTerm === 'HA') {
        // Skip a missed-segment hold that duplicates a transition-segment one.
        if (segment === 'missed' && transitionHoldKeys.has(holdKey(l))) continue
        // Shape geometry works in TRUE bearings; l.course is the MAGNETIC inbound.
        const track = holdTrack(l.lat, l.lon, magneticToTrue(l.course, magVarDeg), l.turnRight, l.legNm)
        features.push(
          lineFeature(track, {
            kind: 'hold',
            segment,
            transitionId,
            fixId: l.fixId,
            inboundCourseMag: l.course,
            turnRight: l.turnRight,
            alt: l.altConstraint,
          }),
        )
      } else if (l.pathTerm === 'PI') {
        // The raw magCourse on a PI leg is the barb course, not the outbound
        // course — use the derived outbound (magnetic → true for drawing), and
        // pass the "remain within" limit as the drawn length (shape clamps it).
        const outMag = l.pi ? l.pi.outboundCourseMag : l.course
        const inMag = l.pi ? l.pi.inboundCourseMag : (l.course + 180) % 360
        const limitNm = l.pi ? l.pi.limitNm : l.legNm
        // Anchor the barb on the final path when the PI fix is collocated with
        // the FAF (e.g. KAWO AW ≈ WATON) so the outbound leg lies on the final
        // course line instead of drifting off it.
        const anchor =
          fafFix && approxDistNm(l.lat, l.lon, fafFix.lat, fafFix.lon) <= PT_FAF_COLLOCATE_NM
            ? fafFix
            : { lat: l.lat, lon: l.lon }
        const barb = procedureTurn(anchor.lat, anchor.lon, magneticToTrue(outMag, magVarDeg), l.turnRight, limitNm)
        features.push(
          lineFeature(barb, {
            kind: 'pt',
            segment,
            transitionId,
            fixId: l.fixId,
            outboundCourseMag: outMag,
            inboundCourseMag: inMag,
            turnRight: l.turnRight,
          }),
        )
      }
    }
  }

  return features
}

/** Cheap equirectangular distance in nm — fine for the sub-nm collocation test. */
function approxDistNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = lat1 - lat2
  const dLon = (lon1 - lon2) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)
  return Math.hypot(dLat, dLon) * 60
}

/**
 * Parse a full FAACIFP18 (ARINC 424) text file into per-airport procedure data.
 *
 * This is the exact grouping/enumeration logic that used to live inline in
 * `cifpParser.worker.ts`'s `onmessage` handler, moved verbatim into a pure,
 * node-runnable function so both the Web Worker and the build scripts
 * (`scripts/buildAirportIndex.ts`) produce byte-identical output. The optional
 * `onProgress` callback replaces the worker's `postMessage({type:'progress'})`.
 */
export function parseCifp(text: string, onProgress?: CifpParseProgress): Record<string, CifpAirportData> {
  const lines = text.split('\n')
  const total = lines.length

  // Pass 1: collect fix/navaid lat/lon.
  // waypointDb is keyed by globally-unique fix name (terminal waypoints,
  // enroute fixes, VOR/NDB). runwayDb is keyed by `${icao}:${RWxx}` because
  // runway identifiers like RW34C repeat across airports and must not collide.
  const waypointDb = new Map<string, WaypointRecord>()
  const runwayDb = new Map<string, WaypointRecord>()
  // NDB positions (enroute D/B + airport-terminal P/N records), used to detect
  // a Locator Outer Marker: an approach FAF collocated with an NDB. The FAA
  // CIFP carries no marker-beacon records, so a collocated locator is the only
  // available signal for a marker on the procedure. See markerForFaf below.
  const ndbCoords: Array<{ lat: number; lon: number }> = []
  // ILS localizer positions, keyed by `${icao}:${locId}`. Localizer ids (e.g.
  // IPAE) repeat across airports and serve as the DME reference for ILS legs.
  const localizerDb = new Map<string, WaypointRecord>()

  // Airport reference positions and magnetic variation (PA records). The
  // magvar converts MSA/TAA magnetic sector bearings to true; the reference
  // position resolves airport-centered MSA records.
  const airportRefDb = new Map<string, WaypointRecord>()
  const magVarByAirport = new Map<string, number | null>()
  // Runway length + threshold elevation (PG extras) merged with the runway
  // threshold position, keyed by airport then runway id (e.g. RW16C).
  const runwayInfoByAirport = new Map<string, Record<string, CifpRunwayInfo>>()
  // ILS glide-slope angle/TCH (PI records), keyed by `${icao}:${runway}` so an
  // ILS approach can look up its glide path by the runway it serves. A record
  // carrying an actual GS angle wins over a LOC-only record for the same runway.
  const ilsGsByRunway = new Map<string, IlsGsFields>()
  // Raw MSA (PS) / TAA (PK) records per airport, resolved after pass 1 when the
  // fix database is complete. Path point (PP) glide paths keyed by approach id.
  const msaRawByAirport = new Map<string, MsaRawRecord[]>()
  const taaRawByAirport = new Map<string, TaaRawRecord[]>()
  const pathPointByKey = new Map<string, { gpaDeg: number | null; tchFt: number | null }>()

  onProgress?.(0, 'Building navaid database…')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line || line.length < 60) continue

    const sc = line[4]
    const ss = line[5]

    if (sc === 'P' && line[12] === 'C') {
      // Terminal waypoint (airport section P, subsection C). These hold the
      // coordinates for most SID/STAR/approach fixes (e.g. OTLIE, RENBE).
      // Subsection lives at column 13 for airport records, unlike enroute/
      // navaid records where it is at column 6.
      const fixId = line.slice(13, 18).trim()
      const coords = parseLatLon(line.slice(32, 41).trim(), line.slice(41, 51).trim())
      if (fixId && coords) waypointDb.set(fixId, { ...coords, navaidType: 'FIX' })
    } else if (sc === 'P' && line[12] === 'G') {
      // Runway threshold (airport section P, subsection G). Approach final
      // segments terminate at the runway (e.g. RW34C); without these the line
      // jumps from the last fix straight to the missed-approach point. Keyed
      // by airport because RWxx repeats across airports.
      const icao = line.slice(6, 10).trim()
      const fixId = line.slice(13, 18).trim()
      const coords = parseLatLon(line.slice(32, 41).trim(), line.slice(41, 51).trim())
      if (icao && fixId && coords) {
        runwayDb.set(`${icao}:${fixId}`, { ...coords, navaidType: 'RUNWAY' })
        // Merge runway length + landing threshold elevation into runwayInfo.
        const extras = parseRunwayExtras(line)
        let rwMap = runwayInfoByAirport.get(icao)
        if (!rwMap) {
          rwMap = {}
          runwayInfoByAirport.set(icao, rwMap)
        }
        rwMap[fixId] = {
          id: fixId,
          lat: coords.lat,
          lon: coords.lon,
          thresholdElevFt: extras?.thresholdElevFt ?? null,
          lengthFt: extras?.lengthFt ?? null,
        }
      }
    } else if (sc === 'P' && line[12] === 'I') {
      // ILS localizer (airport section P, subsection I). Carries the localizer
      // antenna position in the standard lat/lon columns — this is the DME
      // reference for ILS approach legs (recommended navaid e.g. IPAE). Keyed
      // by airport because localizer ids repeat across airports.
      const icao = line.slice(6, 10).trim()
      const locId = line.slice(13, 17).trim()
      const coords = parseLatLon(line.slice(32, 41).trim(), line.slice(41, 51).trim())
      if (icao && locId && coords && !localizerDb.has(`${icao}:${locId}`)) {
        localizerDb.set(`${icao}:${locId}`, { ...coords, navaidType: 'LOC' })
      }
      // Glide-slope angle/TCH so ILS approaches can report a glide path.
      const gs = parseIlsGsFields(line)
      if (gs && gs.runwayId) {
        const key = `${gs.icao}:${gs.runwayId}`
        const existing = ilsGsByRunway.get(key)
        if (!existing || (existing.gsAngleDeg == null && gs.gsAngleDeg != null)) {
          ilsGsByRunway.set(key, gs)
        }
      }
    } else if (sc === 'P' && line[12] === 'A') {
      // Airport reference (airport section P, subsection A). Provides the
      // magnetic variation (for MSA/TAA true-bearing conversion) and the
      // reference position (for airport-centered MSA records).
      const icao = line.slice(6, 10).trim()
      if (icao && !magVarByAirport.has(icao)) {
        magVarByAirport.set(icao, parseAirportMagVar(line))
        const coords = parseLatLon(line.slice(32, 41).trim(), line.slice(41, 51).trim())
        if (coords) airportRefDb.set(icao, { ...coords, navaidType: 'AIRPORT' })
      }
    } else if (sc === 'P' && line[12] === 'S') {
      // MSA (minimum sector altitude). Resolved to positions after pass 1.
      const rec = parseMsaRecord(line)
      if (rec) {
        const list = msaRawByAirport.get(rec.icao) ?? []
        list.push(rec)
        msaRawByAirport.set(rec.icao, list)
      }
    } else if (sc === 'P' && line[12] === 'K') {
      // TAA (terminal arrival area). Resolved to positions after pass 1.
      const rec = parseTaaRecord(line)
      if (rec) {
        const list = taaRawByAirport.get(rec.icao) ?? []
        list.push(rec)
        taaRawByAirport.set(rec.icao, list)
      }
    } else if (sc === 'P' && line[12] === 'P') {
      // Path point (RNAV glide path). Keyed by approach ident for the approach.
      const pp = parsePathPointRecord(line)
      if (pp) pathPointByKey.set(`${pp.icao}:${pp.approachId}`, { gpaDeg: pp.gpaDeg, tchFt: pp.tchFt })
    } else if (sc === 'E' && ss === 'A') {
      // Enroute waypoint
      const fixId = line.slice(13, 18).trim()
      const latStr = line.slice(32, 41).trim()
      const lonStr = line.slice(41, 51).trim()
      const coords = parseLatLon(latStr, lonStr)
      if (fixId && coords) waypointDb.set(fixId, { ...coords, navaidType: 'FIX' })
    } else if (sc === 'D' && ss === ' ') {
      // VOR
      const fixId = line.slice(13, 17).trim()
      const latStr = line.slice(32, 41).trim()
      const lonStr = line.slice(41, 51).trim()
      const coords = parseLatLon(latStr, lonStr)
      if (fixId && coords) waypointDb.set(fixId, { ...coords, navaidType: 'VOR' })
    } else if (sc === 'D' && ss === 'B') {
      // NDB (enroute)
      const fixId = line.slice(13, 17).trim()
      const latStr = line.slice(32, 41).trim()
      const lonStr = line.slice(41, 51).trim()
      const coords = parseLatLon(latStr, lonStr)
      if (fixId && coords) {
        waypointDb.set(fixId, { ...coords, navaidType: 'NDB' })
        ndbCoords.push(coords)
      }
    } else if (sc === 'P' && ss === 'N') {
      // Airport-terminal NDB (compass locator). Uses the enroute-style layout
      // (subsection at col 6, coords at cols 33-51). These are the locators
      // that make an outer marker a LOM — the collocation the marker detection
      // relies on. Don't clobber an enroute fix of the same ident already in
      // waypointDb; the coords still feed ndbCoords for collocation.
      const fixId = line.slice(13, 17).trim()
      const coords = parseLatLon(line.slice(32, 41).trim(), line.slice(41, 51).trim())
      if (fixId && coords) {
        if (!waypointDb.has(fixId)) waypointDb.set(fixId, { ...coords, navaidType: 'NDB' })
        ndbCoords.push(coords)
      }
    }
  }

  onProgress?.(15, 'Parsing procedures…')

  // Pass 2: parse procedure records.
  // Group by airport → procedure id → transition → sequence. Transitions must
  // be kept separate: a SID/STAR/approach has multiple runway and enroute
  // transitions that each restart their sequence numbers at 010, so merging
  // them into one sequence map would overwrite legs and tangle the path.
  type ProcKey = string
  type TransitionMap = Map<string, Map<number, ProcedureLeg>>
  const procGroups = new Map<string, Map<ProcKey, { type: ProcedureType; transitions: TransitionMap; runways: Set<string> }>>()

  for (let i = 0; i < lines.length; i++) {
    if (i % 50000 === 0) {
      const pct = 15 + Math.round((i / total) * 70)
      onProgress?.(pct, `Parsing line ${i}/${total}…`)
    }

    const line = lines[i]
    if (!line || line.length < 100) continue

    const rec = parseProcRecord(line)
    if (!rec) continue

    const procType = classifyProcedure(rec.subSectionCode)
    if (!procType) continue

    const icao = rec.airportIcao
    let airportMap = procGroups.get(icao)
    if (!airportMap) {
      airportMap = new Map()
      procGroups.set(icao, airportMap)
    }

    const procKey = `${procType}:${rec.procedureId}`
    let proc = airportMap.get(procKey)
    if (!proc) {
      proc = { type: procType, transitions: new Map(), runways: new Set() }
      airportMap.set(procKey, proc)
    }

    // Extract runway applicability from the transition id (e.g. RW16C)
    const rwMatch = rec.transitionId.match(/(\d{2}[LRC]?)$/)
    if (rwMatch) proc.runways.add(rwMatch[1])

    if (!rec.fixId) continue

    // Procedure leg records reference a fix by name; they do NOT carry inline
    // coordinates (cols 33–51 hold leg path/terminator data). Resolve the
    // position from the waypoint/navaid database, falling back to this
    // airport's runway thresholds for RWxx fixes.
    const dbEntry = waypointDb.get(rec.fixId) ?? runwayDb.get(`${rec.airportIcao}:${rec.fixId}`)
    if (!dbEntry) continue
    const coords = dbEntry

    const navaidType: NavaidType = dbEntry.navaidType ?? 'FIX'
    const altConstraint = parseArinc424AltDescriptor(rec.altDescriptor, rec.alt1, rec.alt2)

    const transitionKey = rec.transitionId || '(common)'
    let transition = proc.transitions.get(transitionKey)
    if (!transition) {
      transition = new Map()
      proc.transitions.set(transitionKey, transition)
    }

    const rhoRaw = parseInt(rec.rho) || 0
    const courseMag = (parseInt(rec.magCourse) || 0) / 10
    const legNm = parseLegLen(rec.legLen)
    const turnRight = rec.turnDir !== 'L'
    transition.set(rec.sequenceNumber, {
      seq: rec.sequenceNumber,
      fixId: rec.fixId,
      lat: coords.lat,
      lon: coords.lon,
      navaidType,
      altConstraint,
      pathTerm: rec.pathTerm,
      role: legRole(rec.descCode4, rec.pathTerm),
      flyover: rec.flyover,
      turnRight,
      course: courseMag,
      legNm,
      speedKt: parseInt(rec.speedLimit) || 0,
      dmeNm: rhoRaw > 0 ? rhoRaw / 10 : null,
      recNavId: rec.recNav,
      vertAngleDeg: parseVertAngleDeg(rec.vertAngle),
      // On a PI leg the coded magCourse is the barb course and legLen the
      // "remain within" limit — derive the real outbound/inbound courses.
      ...(rec.pathTerm === 'PI' ? { pi: derivePi(courseMag, turnRight, legNm) } : {}),
    })
  }

  onProgress?.(85, 'Building GeoJSON…')

  // Convert to CifpAirportData per airport.
  resetColorCounters()
  const result: Record<string, CifpAirportData> = {}

  const legToWaypoint = (l: ProcedureLeg): ProcedureWaypoint => ({
    id: l.fixId,
    lat: l.lat,
    lon: l.lon,
    navaidType: l.navaidType,
    altConstraint: l.altConstraint,
    sequenceNumber: l.seq,
  })

  for (const [icao, airportMap] of procGroups) {
    const procedures: Procedure[] = []
    // Airport magnetic variation (east +), used to convert coded magnetic
    // courses to true for the hold/procedure-turn shape geometry.
    const magVarDeg = magVarByAirport.get(icao) ?? null
    // Fix id → approach idents referencing it (fix or recommended navaid), so
    // an MSA centered on that fix can list the approaches it serves.
    const centerFixToApproaches = new Map<string, Set<string>>()
    for (const [procKey, group] of airportMap) {
      const [, name] = procKey.split(':')

      // Each transition becomes its own ordered leg list, keyed by its id so
      // the GeoJSON builder can tag features for opposite-direction SID dashing.
      // Single-leg transitions are kept: a hold-in-lieu-of-PT (HILPT) is coded
      // as its own one-leg HF transition (e.g. KAWO R34's "SAVOY"), which
      // draws no path line but must still emit its racetrack, feed NoPT
      // inference, and surface the hold's constraint.
      const transitionEntries = Array.from(group.transitions.entries())
        .map(([id, seqMap]) => ({ id, legs: Array.from(seqMap.values()).sort((a, b) => a.seq - b.seq) }))
        .filter(({ legs }) => legs.length >= 1)

      if (transitionEntries.length === 0) continue

      // Representative path for auto-detection: the longest transition
      // (usually the procedure's core trunk shared across runways).
      const representative = transitionEntries.reduce((a, b) => (b.legs.length > a.legs.length ? b : a)).legs

      // Deduped waypoint symbols across all transitions, preferring the most
      // significant role for any fix that appears more than once.
      // Precision approaches (ILS, procedure id starting "I") mark the FAF as
      // the glideslope intercept — drawn with a lightning bolt, not a cross.
      const isPrecision = group.type === 'APPROACH' && name[0] === 'I'
      const ROLE_RANK: Record<WaypointRole, number> = { map: 6, faf: 5, iaf: 4, if: 3, hold: 2, normal: 1 }
      const symbolMap = new Map<string, WaypointSymbol>()
      // Recommended-navaid ids referenced by DME fixes; each is emitted as its
      // own symbol below so the DME reference point is visible on the map.
      const dmeNavaidIds = new Set<string>()
      for (const { legs } of transitionEntries) {
        for (const l of legs) {
          const key = `${l.fixId}:${l.lat.toFixed(4)}:${l.lon.toFixed(4)}`
          const existing = symbolMap.get(key)
          // The MAP/runway altitude is the threshold elevation, not a crossing
          // restriction — don't render it as one.
          const noRestriction = l.role === 'map' || l.navaidType === 'RUNWAY'
          const alt = noRestriction ? null : l.altConstraint
          const speedKt = noRestriction || !l.speedKt ? null : l.speedKt
          const gsFaf = l.role === 'faf' && isPrecision
          const dmeNavaid = l.dmeNm != null && l.recNavId ? l.recNavId : null
          if (dmeNavaid) dmeNavaidIds.add(dmeNavaid)
          if (!existing) {
            symbolMap.set(key, {
              id: l.fixId, lat: l.lat, lon: l.lon, navaidType: l.navaidType,
              role: l.role, alt, speedKt, gsFaf, flyover: l.flyover,
              dmeNm: l.dmeNm, dmeNavaid,
            })
          } else {
            if (ROLE_RANK[l.role] > ROLE_RANK[existing.role]) existing.role = l.role
            if (!existing.alt && alt) existing.alt = alt
            if (!existing.speedKt && speedKt) existing.speedKt = speedKt
            if (gsFaf) existing.gsFaf = true
            if (l.flyover) existing.flyover = true
            if (existing.dmeNm == null && l.dmeNm != null) {
              existing.dmeNm = l.dmeNm
              existing.dmeNavaid = dmeNavaid
            }
          }
        }
      }

      // Emit each DME reference navaid as its own symbol so the point the DME
      // distance is measured from is shown. Localizers live in localizerDb
      // (keyed by airport); VOR/VORTAC/NDB are in the global waypointDb. Skip
      // any navaid already present as a fix symbol (same id + position).
      for (const navId of dmeNavaidIds) {
        const nav = waypointDb.get(navId) ?? localizerDb.get(`${icao}:${navId}`)
        if (!nav) continue
        const key = `${navId}:${nav.lat.toFixed(4)}:${nav.lon.toFixed(4)}`
        if (symbolMap.has(key)) continue
        symbolMap.set(key, {
          id: navId, lat: nav.lat, lon: nav.lon, navaidType: nav.navaidType,
          role: 'normal', alt: null, speedKt: null, gsFaf: false,
          flyover: false, dmeNm: null, dmeNavaid: null, isDmeSource: true,
        })
      }

      // LOM detection: mark an approach FAF that sits on top of an NDB (a
      // compass locator) as an outer marker. The CIFP has no marker-beacon
      // records, so a collocated locator is the only signal — this reliably
      // catches LOMs (e.g. KAWO LOC 34 FAF WATON over the AWO NDB) but not
      // markerless OM/MM/IM. markerLocator drives the NDB overlay. RNAV/RNP
      // procedures ('R'/'H' idents) are excluded: their plates never chart
      // marker beacons, and an RNAV FAF placed beside a locator (KAWO R34
      // YAYKU next to the AW NDB) is not a LOM.
      if (group.type === 'APPROACH' && name[0] !== 'R' && name[0] !== 'H') {
        const MARKER_COLLOCATE_NM = 0.5
        const syms = Array.from(symbolMap.values())
        for (const faf of syms) {
          if (faf.role !== 'faf') continue
          const isLocator =
            faf.navaidType === 'NDB' ||
            ndbCoords.some((n) => approxDistNm(faf.lat, faf.lon, n.lat, n.lon) <= MARKER_COLLOCATE_NM)
          if (!isLocator) continue
          faf.marker = 'OM'
          faf.markerLocator = true
          // The FAF fix and the locator NDB are cataloged ~100 ft apart but are
          // the same LOM point — snap any collocated NDB symbol (e.g. the
          // missed-approach hold at the locator) onto the FAF so the two render
          // coincident rather than drifting apart when zoomed in.
          for (const sym of syms) {
            if (
              sym !== faf &&
              sym.navaidType === 'NDB' &&
              approxDistNm(faf.lat, faf.lon, sym.lat, sym.lon) <= MARKER_COLLOCATE_NM
            ) {
              sym.lat = faf.lat
              sym.lon = faf.lon
            }
          }
        }
      }

      const features = buildProcedureFeatures(transitionEntries, magVarDeg)

      // Surface each transition's ordered legs (ProcedureLeg[]) for profile
      // rendering, tagging NoPT routes, and resolve the published glide path.
      const noPtIds = computeNoPtTransitionIds(transitionEntries, group.type === 'APPROACH')
      const transitions: ProcedureTransition[] = transitionEntries.map(({ id, legs }) => ({
        id,
        legs,
        ...(noPtIds.has(id) ? { noPt: true } : {}),
      }))

      let gpaDeg: number | null | undefined
      let tchFt: number | null | undefined
      let gsSource: Procedure['gsSource'] = 'default'
      let courseReversal: Procedure['courseReversal']
      let holdInLieu: Procedure['holdInLieu']
      if (group.type === 'APPROACH') {
        // Course-reversal (procedure turn) metadata: the PI leg's derived
        // outbound/inbound courses plus the turn constraint (its own alt) and
        // the entry alt (the IF leg at the same fix in the same transition).
        courseReversal = deriveCourseReversal(transitionEntries) ?? undefined
        // Hold-in-lieu-of-PT (HF leg) — the racetrack course reversal.
        holdInLieu = deriveHoldInLieu(transitionEntries) ?? undefined
        // Approach transitions are named by IAF, not runway, so the
        // transition-id scrape above misses them — the runway is encoded in
        // the procedure ident itself (e.g. I16R → 16R). Without this, the
        // TDZE/runway-length lookup and the ILS glide-slope fallback below
        // both come up empty.
        const rwFromName = name.match(/^[A-Z](\d{2}[LRC]?)/)
        if (rwFromName) group.runways.add(rwFromName[1])
        for (const { legs } of transitionEntries) {
          for (const l of legs) {
            for (const fx of [l.fixId, l.recNavId]) {
              if (!fx) continue
              let set = centerFixToApproaches.get(fx)
              if (!set) {
                set = new Set()
                centerFixToApproaches.set(fx, set)
              }
              set.add(name)
            }
          }
        }
        // RNAV approaches carry a path point; ILS ('I…') fall back to the
        // localizer glide slope for the runway they serve; non-precision
        // approaches fall back to the final-approach leg's coded vertical
        // descent angle (VDA); otherwise no published glide path.
        const pp = pathPointByKey.get(`${icao}:${name}`)
        if (pp) {
          gpaDeg = pp.gpaDeg
          tchFt = pp.tchFt
          if (gpaDeg != null) gsSource = 'pathPoint'
        } else if (name[0] === 'I') {
          for (const rw of group.runways) {
            const gs = ilsGsByRunway.get(`${icao}:${rw}`)
            if (gs && gs.gsAngleDeg != null) {
              gpaDeg = gs.gsAngleDeg
              tchFt = gs.gsTchFt
              gsSource = 'ilsGs'
              break
            }
          }
        }
        if (gpaDeg == null) {
          // VDA fallback: a leg vertical angle on/before the MAP (typically
          // the runway/MAP leg on non-precision approaches, e.g. KAWO LOC 34).
          const vda = deriveVdaGpaDeg(transitionEntries)
          if (vda != null) {
            gpaDeg = vda
            gsSource = 'vda'
          }
        }
      }

      procedures.push({
        id: `${icao}-${group.type}-${name}`,
        icao,
        name,
        type: group.type,
        runways: Array.from(group.runways),
        waypoints: representative.map(legToWaypoint),
        symbols: Array.from(symbolMap.values()),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        geojson: { type: 'FeatureCollection', features } as any,
        hasGeometry: true,
        color: nextProcedureColor(group.type),
        transitions,
        ...(gpaDeg !== undefined ? { gpaDeg } : {}),
        ...(tchFt !== undefined ? { tchFt } : {}),
        ...(group.type === 'APPROACH' ? { gsSource } : {}),
        ...(magVarDeg != null ? { magVarDeg } : {}),
        ...(courseReversal ? { courseReversal } : {}),
        ...(holdInLieu ? { holdInLieu } : {}),
      })
    }

    if (procedures.length === 0) continue

    const airportRef = airportRefDb.get(icao)
    const resolveFix = (fixId: string): { lat: number; lon: number } | null => {
      const r =
        waypointDb.get(fixId) ??
        runwayDb.get(`${icao}:${fixId}`) ??
        localizerDb.get(`${icao}:${fixId}`) ??
        (fixId === icao ? airportRef : undefined)
      return r ? { lat: r.lat, lon: r.lon } : null
    }

    const safeAltitudes = buildSafeAltitudeAreas(
      msaRawByAirport.get(icao) ?? [],
      taaRawByAirport.get(icao) ?? [],
      resolveFix,
      magVarDeg,
      (centerFixId) => Array.from(centerFixToApproaches.get(centerFixId) ?? []),
    ).map((area) => ({
      // buildSafeAltitudeAreas works with bare ARINC idents; qualify them to
      // full Procedure.id form so visibility/detection-history lookups match.
      ...area,
      procedureIds: area.procedureIds.map((n) => `${icao}-APPROACH-${n}`),
    }))

    result[icao] = {
      procedures,
      safeAltitudes,
      runwayInfo: runwayInfoByAirport.get(icao) ?? {},
      magVarDeg,
    }
  }

  onProgress?.(100, 'Done.')
  return result
}
