import { describe, it, expect } from 'vitest'
import {
  initialDetectionState,
  reduceDetection,
  deriveProcedureActivity,
  DEFAULT_DETECTION_CONFIG,
  type DetectionState,
  type ProcedureActivity,
} from '../detectionMachine'
import type { AirportContext } from '../procedureMatch'
import type { Procedure, WaypointSymbol } from '../../types/procedure'
import type { InterpolatedAircraft } from '../../types/aircraft'
import type { AtisInfo } from '../../api/datis'

const CONFIG = DEFAULT_DETECTION_CONFIG
const CTX: AirportContext = { lat: 47.45, lon: -122.31, elevationFt: 0 }

// KSEA-like southbound parallels. 0.13 nm ≈ 0.0032° lon at lat 47.45.
const LON_16C = -122.31
const LON_16L = -122.3132

function approach(name: string, lon: number, withMap = false): Procedure {
  const wpts = withMap
    ? [
        { id: 'N', lat: 47.6 },
        { id: 'MAPWP', lat: 47.45 },
        { id: 'S', lat: 47.3 },
      ]
    : [
        { id: 'N', lat: 47.6 },
        { id: 'S', lat: 47.3 },
      ]
  const symbols: WaypointSymbol[] = withMap
    ? [
        {
          id: 'MAPWP',
          lat: 47.45,
          lon,
          navaidType: 'FIX',
          role: 'map',
          alt: null,
          speedKt: null,
          gsFaf: false,
          flyover: false,
        },
      ]
    : []
  return {
    id: name,
    icao: 'KSEA',
    name,
    type: 'APPROACH',
    runways: [name.slice(1)],
    waypoints: wpts.map((w, i) => ({
      id: w.id,
      lat: w.lat,
      lon,
      navaidType: 'FIX',
      altConstraint: null,
      sequenceNumber: (i + 1) * 10,
    })),
    symbols,
    geojson: { type: 'FeatureCollection', features: [] },
    hasGeometry: true,
    color: '#34d399',
  }
}

function plane(hex: string, lat: number, lon: number, track = 180): InterpolatedAircraft {
  return {
    hex,
    flight: hex.toUpperCase(),
    registration: 'N1',
    typeCode: 'B738',
    lat,
    lon,
    altBaro: 3000,
    altGeom: 3000,
    groundspeed: 180,
    track,
    baroRate: -500,
    squawk: '1200',
    lastPollMs: 0,
    interpLat: lat,
    interpLon: lon,
  }
}

function atis(runwayPrefs: Record<string, string[]>): AtisInfo {
  return { code: 'A', runwayPrefs, depRunways: [], visualRunways: [], raw: '' }
}

interface Poll {
  t: number
  aircraft: InterpolatedAircraft[]
  atisInfo?: AtisInfo | null
}
interface Step {
  state: DetectionState
  events: ReturnType<typeof reduceDetection>['events']
  activity: Record<string, ProcedureActivity>
}

function runPolls(procedures: Procedure[], polls: Poll[], baseAtis: AtisInfo | null = null) {
  let state = initialDetectionState()
  const steps: Step[] = polls.map((poll) => {
    const atisInfo = poll.atisInfo !== undefined ? poll.atisInfo : baseAtis
    const r = reduceDetection(
      state,
      { nowMs: poll.t, aircraft: poll.aircraft },
      procedures,
      CTX,
      atisInfo,
      CONFIG,
    )
    state = r.state
    return { state, events: r.events, activity: deriveProcedureActivity(state, procedures) }
  })
  return { state, steps }
}

// Confirmation needs 3 matches spanning ≥10 s → polls at t=0,5,10 s.
const CONFIRM_TS = [0, 5000, 10000]

describe('detectionMachine', () => {
  it('(1) one-poll crosser becomes a candidate only, then expires', () => {
    const proc = approach('I16C', LON_16C)
    const onLine = plane('a', 47.45, LON_16C)
    const offLine = plane('a', 47.45, -122.0) // present but far off the line
    const { steps, state } = runPolls([proc], [
      { t: 0, aircraft: [onLine] },
      { t: 5000, aircraft: [offLine] },
      { t: 10000, aircraft: [offLine] },
      { t: 15000, aircraft: [offLine] },
      { t: 20000, aircraft: [offLine] },
    ])
    // Candidate after the first poll, never confirmed, never shown.
    expect(steps[0].state.tracks.a?.I16C?.phase).toBe('candidate')
    expect(steps[0].activity).toEqual({})
    // Gone after the 15 s candidate TTL, with no lost event (candidates are silent).
    expect(state.tracks.a).toBeUndefined()
    expect(steps.every((s) => s.events.every((e) => e.type !== 'confirmed'))).toBe(true)
  })

  it('(2) three matches over 10 s confirm and assign', () => {
    const proc = approach('I16C', LON_16C)
    const { steps, state } = runPolls(
      [proc],
      CONFIRM_TS.map((t) => ({ t, aircraft: [plane('a', 47.45, LON_16C)] })),
    )
    expect(steps[0].activity).toEqual({})
    expect(steps[1].activity).toEqual({})
    expect(steps[2].activity.I16C.hexes).toEqual(['a'])
    expect(state.assignments).toEqual({ a: 'I16C' })
    expect(steps[2].events.some((e) => e.type === 'confirmed')).toBe(true)
  })

  it('(3) a confirmed track survives a single 0.5 nm noisy poll', () => {
    const proc = approach('I16C', LON_16C)
    const noisyLon = LON_16C + 0.0123 // ~0.5 nm: inside confirmed (0.6) not candidate (0.35)
    const { steps } = runPolls([proc], [
      ...CONFIRM_TS.map((t) => ({ t, aircraft: [plane('a', 47.45, LON_16C)] })),
      { t: 15000, aircraft: [plane('a', 47.45, noisyLon)] },
      { t: 20000, aircraft: [plane('a', 47.45, LON_16C)] },
    ])
    expect(steps[3].state.tracks.a.I16C.phase).toBe('confirmed')
    expect(steps[3].state.assignments).toEqual({ a: 'I16C' })
  })

  it('(4) a turn-away is lost after 30 s with lastActiveMs frozen', () => {
    const proc = approach('I16C', LON_16C)
    const polls: Poll[] = [
      ...CONFIRM_TS.map((t) => ({ t, aircraft: [plane('a', 47.45, LON_16C)] })),
      // Turned around (northbound) — off-direction, no more matches.
      { t: 15000, aircraft: [plane('a', 47.45, LON_16C, 0)] },
      { t: 40000, aircraft: [plane('a', 47.45, LON_16C, 0)] }, // 30 s since last match → still alive
      { t: 45000, aircraft: [plane('a', 47.45, LON_16C, 0)] }, // 35 s → expired
    ]
    const { steps } = runPolls([proc], polls)
    // Still assigned and lastActiveMs frozen at the last real match (t=10 s).
    expect(steps[4].state.assignments).toEqual({ a: 'I16C' })
    expect(steps[4].activity.I16C.lastActiveMs).toBe(10000)
    // Dropped on the poll past the 30 s confirmed TTL.
    expect(steps[5].state.tracks.a).toBeUndefined()
    expect(steps[5].state.assignments).toEqual({})
    expect(steps[5].activity).toEqual({})
    expect(steps[5].events.some((e) => e.type === 'lost')).toBe(true)
  })

  it('(5) planes on 16L and 16C are each assigned their own runway', () => {
    const procs = [approach('I16C', LON_16C), approach('I16L', LON_16L)]
    const { steps, state } = runPolls(
      procs,
      CONFIRM_TS.map((t) => ({
        t,
        aircraft: [plane('a', 47.45, LON_16C), plane('b', 47.45, LON_16L)],
      })),
    )
    expect(state.assignments).toEqual({ a: 'I16C', b: 'I16L' })
    expect(steps[2].activity.I16C.hexes).toEqual(['a'])
    expect(steps[2].activity.I16L.hexes).toEqual(['b'])
  })

  it('(6) cross-track jitter between parallels does not flip the assignment', () => {
    const procs = [approach('I16C', LON_16C), approach('I16L', LON_16L)]
    const near16C = LON_16C - 0.0006 // clearly nearer 16C
    const near16L = LON_16L + 0.0006 // clearly nearer 16L
    const polls: Poll[] = [
      ...CONFIRM_TS.map((t) => ({ t, aircraft: [plane('a', 47.45, near16C)] })),
      { t: 15000, aircraft: [plane('a', 47.45, near16L)] },
      { t: 20000, aircraft: [plane('a', 47.45, near16C)] },
      { t: 25000, aircraft: [plane('a', 47.45, near16L)] },
      { t: 30000, aircraft: [plane('a', 47.45, near16C)] },
    ]
    const { steps, state } = runPolls(procs, polls)
    // Alternating "closer" polls never reach a 3-streak → assignment holds.
    expect(state.assignments).toEqual({ a: 'I16C' })
    for (const s of steps.slice(2)) expect(s.state.assignments.a).toBe('I16C')
  })

  it('(7) ATIS selects among same-runway types and a flip reassigns promptly', () => {
    const procs = [approach('I16C', LON_16C), approach('R16C', LON_16C)]
    const polls: Poll[] = [
      ...CONFIRM_TS.map((t) => ({ t, aircraft: [plane('a', 47.45, LON_16C)] })),
      { t: 15000, aircraft: [plane('a', 47.45, LON_16C)], atisInfo: atis({ '16C': ['R'] }) },
    ]
    const { steps } = runPolls(procs, polls, atis({ '16C': ['I'] }))
    expect(steps[2].state.assignments).toEqual({ a: 'I16C' })
    expect(steps[3].state.assignments).toEqual({ a: 'R16C' })
    expect(steps[3].events.some((e) => e.type === 'assigned' && e.procId === 'R16C')).toBe(true)
  })

  it('(8) missed approach stays tracked; a fresh past-MAP hex never is', () => {
    const proc = approach('I16C', LON_16C, true)
    const polls: Poll[] = [
      ...CONFIRM_TS.map((t) => ({
        t,
        aircraft: [plane('a', 47.5, LON_16C), plane('b', 47.4, LON_16C)], // a pre-MAP, b past-MAP
      })),
      { t: 15000, aircraft: [plane('a', 47.4, LON_16C), plane('b', 47.4, LON_16C)] }, // a now past-MAP
    ]
    const { steps, state } = runPolls([proc], polls)
    // a confirmed on the approach and still assigned after crossing the MAP.
    expect(steps[3].state.assignments).toEqual({ a: 'I16C' })
    expect(steps[3].activity.I16C.hexes).toEqual(['a'])
    // b was only ever seen past the MAP → departure, never tracked.
    expect(state.tracks.b).toBeUndefined()
  })

  it('(9) a vanished hex drops its tracks and assignment', () => {
    const proc = approach('I16C', LON_16C)
    const polls: Poll[] = [
      ...CONFIRM_TS.map((t) => ({ t, aircraft: [plane('a', 47.45, LON_16C)] })),
      { t: 15000, aircraft: [] },
    ]
    const { steps } = runPolls([proc], polls)
    expect(steps[3].state.tracks.a).toBeUndefined()
    expect(steps[3].state.assignments).toEqual({})
    expect(steps[3].activity).toEqual({})
    expect(steps[3].events.some((e) => e.type === 'lost')).toBe(true)
  })

  it('(10) identical snapshots produce stable hexes and no events', () => {
    const proc = approach('I16C', LON_16C)
    const polls: Poll[] = [
      ...CONFIRM_TS.map((t) => ({ t, aircraft: [plane('a', 47.45, LON_16C)] })),
      { t: 15000, aircraft: [plane('a', 47.45, LON_16C)] },
      { t: 20000, aircraft: [plane('a', 47.45, LON_16C)] },
    ]
    const { steps } = runPolls([proc], polls)
    expect(steps[3].events).toEqual([])
    expect(steps[4].events).toEqual([])
    expect(steps[3].activity.I16C.hexes).toEqual(['a'])
    expect(steps[4].activity.I16C.hexes).toEqual(['a'])
  })
})
