import type { Procedure, ProcedureWaypoint, NavaidType, ProcedureType } from '../types/procedure'
import { parseArinc424AltDescriptor } from '../utils/altitudeConstraint'
import { nextProcedureColor, resetColorCounters } from '../utils/colorScheme'
import { parseLatLon } from '../utils/arincCoords'
import * as turf from '@turf/turf'

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
  latStr: string
  lonStr: string
  altDescriptor: string
  alt1: string
  alt2: string
  speedLimit: string
  routeType: string
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
    latStr: line.slice(32, 41).trim(),
    lonStr: line.slice(41, 51).trim(),
    altDescriptor: line.slice(82, 83),
    alt1: line.slice(84, 89).trim(),
    alt2: line.slice(89, 94).trim(),
    speedLimit: line.slice(99, 102).trim(),
    routeType: line.slice(19, 20),
  }
}

function classifyProcedure(subSection: string): ProcedureType | null {
  if (subSection === 'D') return 'SID'
  if (subSection === 'E') return 'STAR'
  if (subSection === 'F') return 'APPROACH'
  return null
}

function buildGeoJson(transitions: ProcedureWaypoint[][]) {
  const features = transitions
    .filter((wpts) => wpts.length >= 2)
    .map((wpts) => turf.lineString(wpts.map((w) => [w.lon, w.lat] as [number, number])))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return turf.featureCollection(features) as any
}

self.onmessage = function (e: MessageEvent<ParseRequest>) {
  if (e.data.type !== 'parse') return

  try {
    const lines = e.data.text.split('\n')
    const total = lines.length

    // Pass 1: collect fix/navaid lat/lon from EA (enroute fix), D  (VOR), DB (NDB) records
    const waypointDb = new Map<string, WaypointRecord>()

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
    type TransitionMap = Map<string, Map<number, ProcedureWaypoint>>
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
      // coordinates (cols 33–51 hold leg path/terminator data). Always resolve
      // the position from the waypoint/navaid database built in pass 1.
      const dbEntry = waypointDb.get(rec.fixId)
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
        id: rec.fixId,
        lat: coords.lat,
        lon: coords.lon,
        navaidType,
        altConstraint,
        sequenceNumber: rec.sequenceNumber,
      })
    }

    self.postMessage({ type: 'progress', percent: 85, message: 'Building GeoJSON…' } satisfies ParseProgress)

    // Convert to Procedure[]
    resetColorCounters()
    const result: Record<string, Procedure[]> = {}

    for (const [icao, airportMap] of procGroups) {
      const procedures: Procedure[] = []
      for (const [procKey, group] of airportMap) {
        const [, name] = procKey.split(':')

        // Each transition becomes its own ordered leg list.
        const transitionLegs = Array.from(group.transitions.values())
          .map((seqMap) =>
            Array.from(seqMap.values()).sort((a, b) => a.sequenceNumber - b.sequenceNumber),
          )
          .filter((legs) => legs.length >= 2)

        if (transitionLegs.length === 0) continue

        // Representative path for labels + auto-detection: the longest transition
        // (usually the procedure's core trunk shared across runways).
        const representative = transitionLegs.reduce((a, b) => (b.length > a.length ? b : a))

        procedures.push({
          id: `${icao}-${group.type}-${name}`,
          icao,
          name,
          type: group.type,
          runways: Array.from(group.runways),
          waypoints: representative,
          geojson: buildGeoJson(transitionLegs),
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
