import type { Procedure, ProcedureWaypoint, NavaidType, ProcedureType, WaypointRole, WaypointSymbol, AltConstraint } from '../types/procedure'
import { parseArinc424AltDescriptor } from '../utils/altitudeConstraint'
import { nextProcedureColor, resetColorCounters } from '../utils/colorScheme'
import { parseLatLon } from '../utils/arincCoords'
import { holdTrack, procedureTurn } from '../geo/procedureShapes'

export interface ParseRequest {
  type: 'parse'
  text: string
}

export interface ParseProgress {
  type: 'progress'
  percent: number
  message: string
}

export interface ParseResult {
  type: 'result'
  data: Record<string, Procedure[]>
}

export interface ParseError {
  type: 'error'
  message: string
}

interface WaypointRecord {
  lat: number
  lon: number
  navaidType: NavaidType
}

type SectionCode = 'P' | 'E' | 'D'
type SubSectionCode = string

interface Record424 {
  sectionCode: SectionCode
  subSectionCode: SubSectionCode
  airportIcao: string
  procedureId: string
  transitionId: string
  sequenceNumber: number
  fixId: string
  altDescriptor: string
  alt1: string
  alt2: string
  pathTerm: string // path & terminator, cols 48-49 (e.g. CF, TF, HM, HF, PI)
  descCode4: string // waypoint description code position 4, col 43 (A/F/M/H)
  flyover: boolean  // waypoint description code position 2, col 41 ('Y' = flyover)
  turnDir: string // col 44 (L/R)
  magCourse: string // cols 71-74 (tenths of a degree)
  legLen: string // cols 75-78 (route distance / holding leg)
  speedLimit: string // cols 100-102 (knots, a maximum)
}

function parseProcRecord(line: string): Record424 | null {
  if (line.length < 132) return null
  const sectionCode = line[4] as SectionCode
  if (sectionCode !== 'P') return null
  // Airport-section subsection is at column 13 (index 12):
  //   D = SID, E = STAR, F = Approach. Everything else (C terminal waypoint,
  //   G runway, I ILS, P path point, S MSA) is not a procedure leg.
  const subSection = line[12]
  if (!'DEF'.includes(subSection)) return null

  const airportIcao = line.slice(6, 10).trim()
  if (!airportIcao) return null

  return {
    sectionCode,
    subSectionCode: subSection,
    airportIcao,
    procedureId: line.slice(13, 19).trim(),
    transitionId: line.slice(20, 25).trim(),
    sequenceNumber: parseInt(line.slice(26, 29).trim()) || 0,
    fixId: line.slice(29, 34).trim(),
    altDescriptor: line.slice(82, 83),
    alt1: line.slice(84, 89).trim(),
    alt2: line.slice(89, 94).trim(),
    pathTerm: line.slice(47, 49).trim(),
    descCode4: line[42] ?? ' ',
    flyover: (line[40] ?? ' ') === 'Y',
    turnDir: line[43] ?? ' ',
    magCourse: line.slice(70, 74).trim(),
    legLen: line.slice(74, 78).trim(),
    speedLimit: line.slice(99, 102).trim(),
  }
}

/** One parsed leg of a transition, carrying everything geometry/render needs. */
interface Leg {
  seq: number
  fixId: string
  lat: number
  lon: number
  navaidType: NavaidType
  altConstraint: AltConstraint | null
  pathTerm: string
  role: WaypointRole
  flyover: boolean
  turnRight: boolean
  course: number // degrees (from magCourse / 10)
  legNm: number // straight-leg length, nm (time legs approximated)
  speedKt: number // speed restriction (knots, 0 = none)
}

function legRole(descCode4: string, pathTerm: string): WaypointRole {
  if (descCode4 === 'A') return 'iaf'
  if (descCode4 === 'F') return 'faf'
  if (descCode4 === 'M') return 'map'
  if (descCode4 === 'H' || pathTerm === 'HM' || pathTerm === 'HF' || pathTerm === 'HA') return 'hold'
  return 'normal'
}

/** Parse the holding/PT leg length: "T010" = 1.0 min (→ ~4nm), "0040" = 4.0nm. */
function parseLegLen(legLen: string): number {
  if (!legLen) return 0
  if (legLen[0] === 'T') {
    const minutes = (parseInt(legLen.slice(1)) || 0) / 10
    return minutes * 4 // ~4nm per minute at holding speed
  }
  return (parseInt(legLen) || 0) / 10
}

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
 */
function buildProcedureFeatures(transitions: Leg[][]): AnyFeature[] {
  const features: AnyFeature[] = []

  for (const legs of transitions) {
    const mapIdx = legs.findIndex((l) => l.role === 'map')
    const inboundEnd = mapIdx >= 0 ? mapIdx + 1 : legs.length

    const inbound = legs.slice(0, inboundEnd)
    const missed = mapIdx >= 0 ? legs.slice(mapIdx) : [] // start missed at the MAP for continuity

    if (inbound.length >= 2) {
      features.push(lineFeature(inbound.map((l) => [l.lon, l.lat]), { kind: 'path', segment: 'transition' }))
    }
    if (missed.length >= 2) {
      features.push(lineFeature(missed.map((l) => [l.lon, l.lat]), { kind: 'path', segment: 'missed' }))
    }

    // Holds and procedure turns as their own shapes
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i]
      const segment = mapIdx >= 0 && i > mapIdx ? 'missed' : 'transition'
      if (l.pathTerm === 'HM' || l.pathTerm === 'HF' || l.pathTerm === 'HA') {
        const track = holdTrack(l.lat, l.lon, l.course, l.turnRight, l.legNm)
        features.push(lineFeature(track, { kind: 'hold', segment }))
      } else if (l.pathTerm === 'PI') {
        const barb = procedureTurn(l.lat, l.lon, l.course, l.turnRight, l.legNm)
        features.push(lineFeature(barb, { kind: 'pt', segment }))
      }
    }
  }

  return features
}

self.onmessage = function (e: MessageEvent<ParseRequest>) {
  if (e.data.type !== 'parse') return

  try {
    const lines = e.data.text.split('\n')
    const total = lines.length

    // Pass 1: collect fix/navaid lat/lon.
    // waypointDb is keyed by globally-unique fix name (terminal waypoints,
    // enroute fixes, VOR/NDB). runwayDb is keyed by `${icao}:${RWxx}` because
    // runway identifiers like RW34C repeat across airports and must not collide.
    const waypointDb = new Map<string, WaypointRecord>()
    const runwayDb = new Map<string, WaypointRecord>()

    self.postMessage({ type: 'progress', percent: 0, message: 'Building navaid database…' } satisfies ParseProgress)

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
        if (icao && fixId && coords) runwayDb.set(`${icao}:${fixId}`, { ...coords, navaidType: 'RUNWAY' })
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
        // NDB
        const fixId = line.slice(13, 17).trim()
        const latStr = line.slice(32, 41).trim()
        const lonStr = line.slice(41, 51).trim()
        const coords = parseLatLon(latStr, lonStr)
        if (fixId && coords) waypointDb.set(fixId, { ...coords, navaidType: 'NDB' })
      }
    }

    self.postMessage({ type: 'progress', percent: 15, message: 'Parsing procedures…' } satisfies ParseProgress)

    // Pass 2: parse procedure records.
    // Group by airport → procedure id → transition → sequence. Transitions must
    // be kept separate: a SID/STAR/approach has multiple runway and enroute
    // transitions that each restart their sequence numbers at 010, so merging
    // them into one sequence map would overwrite legs and tangle the path.
    type ProcKey = string
    type TransitionMap = Map<string, Map<number, Leg>>
    const procGroups = new Map<string, Map<ProcKey, { type: ProcedureType; transitions: TransitionMap; runways: Set<string> }>>()

    for (let i = 0; i < lines.length; i++) {
      if (i % 50000 === 0) {
        const pct = 15 + Math.round((i / total) * 70)
        self.postMessage({ type: 'progress', percent: pct, message: `Parsing line ${i}/${total}…` } satisfies ParseProgress)
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
        turnRight: rec.turnDir !== 'L',
        course: (parseInt(rec.magCourse) || 0) / 10,
        legNm: parseLegLen(rec.legLen),
        speedKt: parseInt(rec.speedLimit) || 0,
      })
    }

    self.postMessage({ type: 'progress', percent: 85, message: 'Building GeoJSON…' } satisfies ParseProgress)

    // Convert to Procedure[]
    resetColorCounters()
    const result: Record<string, Procedure[]> = {}

    const legToWaypoint = (l: Leg): ProcedureWaypoint => ({
      id: l.fixId,
      lat: l.lat,
      lon: l.lon,
      navaidType: l.navaidType,
      altConstraint: l.altConstraint,
      sequenceNumber: l.seq,
    })

    for (const [icao, airportMap] of procGroups) {
      const procedures: Procedure[] = []
      for (const [procKey, group] of airportMap) {
        const [, name] = procKey.split(':')

        // Each transition becomes its own ordered leg list.
        const transitionLegs = Array.from(group.transitions.values())
          .map((seqMap) => Array.from(seqMap.values()).sort((a, b) => a.seq - b.seq))
          .filter((legs) => legs.length >= 2)

        if (transitionLegs.length === 0) continue

        // Representative path for auto-detection: the longest transition
        // (usually the procedure's core trunk shared across runways).
        const representative = transitionLegs.reduce((a, b) => (b.length > a.length ? b : a))

        // Deduped waypoint symbols across all transitions, preferring the most
        // significant role for any fix that appears more than once.
        // Precision approaches (ILS, procedure id starting "I") mark the FAF as
        // the glideslope intercept — drawn with a lightning bolt, not a cross.
        const isPrecision = group.type === 'APPROACH' && name[0] === 'I'
        const ROLE_RANK: Record<WaypointRole, number> = { map: 5, faf: 4, iaf: 3, hold: 2, normal: 1 }
        const symbolMap = new Map<string, WaypointSymbol>()
        for (const legs of transitionLegs) {
          for (const l of legs) {
            const key = `${l.fixId}:${l.lat.toFixed(4)}:${l.lon.toFixed(4)}`
            const existing = symbolMap.get(key)
            // The MAP/runway altitude is the threshold elevation, not a crossing
            // restriction — don't render it as one.
            const noRestriction = l.role === 'map' || l.navaidType === 'RUNWAY'
            const alt = noRestriction ? null : l.altConstraint
            const speedKt = noRestriction || !l.speedKt ? null : l.speedKt
            const gsFaf = l.role === 'faf' && isPrecision
            if (!existing) {
              symbolMap.set(key, {
                id: l.fixId, lat: l.lat, lon: l.lon, navaidType: l.navaidType,
                role: l.role, alt, speedKt, gsFaf, flyover: l.flyover,
              })
            } else {
              if (ROLE_RANK[l.role] > ROLE_RANK[existing.role]) existing.role = l.role
              if (!existing.alt && alt) existing.alt = alt
              if (!existing.speedKt && speedKt) existing.speedKt = speedKt
              if (gsFaf) existing.gsFaf = true
              if (l.flyover) existing.flyover = true
            }
          }
        }

        const features = buildProcedureFeatures(transitionLegs)

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
        })
      }
      if (procedures.length > 0) result[icao] = procedures
    }

    self.postMessage({ type: 'progress', percent: 100, message: 'Done.' } satisfies ParseProgress)
    self.postMessage({ type: 'result', data: result } satisfies ParseResult)
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) } satisfies ParseError)
  }
}
