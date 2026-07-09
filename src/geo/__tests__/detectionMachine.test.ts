import { describe, it, expect } from 'vitest'
import {
  initialDetectionState,
  reduceDetection,
  pruneDetectionState,
  deriveProcedureActivity,
  DEFAULT_DETECTION_CONFIG,
  type DetectionState,
  type ProcedureActivity,
  type ProcTrack,
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

function plane(hex: string, lat: number, lon: number, track = 180, squawk = '3471'): InterpolatedAircraft {
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
    squawk,
    lastPollMs: 0,
    interpLat: lat,
    interpLon: lon,
  }
}

// Northbound SID: a straight line of fixes from the airport heading north.
// ~0.025° lat ≈ 1.5 nm, so 47.45 → 47.48 covers ~1.8 nm of along-track travel.
function sid(name: string, lon: number): Procedure {
  return {
    id: name,
    icao: 'KSEA',
    name,
    type: 'SID',
    runways: ['34C'],
    waypoints: [
      { id: 'A', lat: 47.45, lon, navaidType: 'FIX', altConstraint: null, sequenceNumber: 10 },
      { id: 'B', lat: 47.6, lon, navaidType: 'FIX', altConstraint: null, sequenceNumber: 20 },
    ],
    symbols: [],
    geojson: { type: 'FeatureCollection', features: [] },
    hasGeometry: true,
    color: '#22d3ee',
  }
}

function atis(runwayPrefs: Record<string, string[]>): AtisInfo {
  return { code: 'A', runwayPrefs, depRunways: [], depRunwaysAdvisory: [], visualRunways: [], raw: '' }
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
      { KSEA: CTX },
      { KSEA: atisInfo },
      CONFIG,
    )
    state = r.state
    return { state, events: r.events, activity: deriveProcedureActivity(state) }
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

  it('(11) a squawk-1200 aircraft never creates a track, even on a perfect line', () => {
    const proc = approach('I16C', LON_16C)
    const { steps, state } = runPolls(
      [proc],
      CONFIRM_TS.map((t) => ({ t, aircraft: [plane('a', 47.45, LON_16C, 180, '1200')] })),
    )
    expect(state.tracks.a).toBeUndefined()
    expect(state.assignments).toEqual({})
    expect(steps.every((s) => s.events.length === 0)).toBe(true)
  })

  it('(12) a SID flyer making along-track progress confirms', () => {
    const proc = sid('BANGR9', LON_16C)
    // Northbound and moving: 47.45 → 47.465 → 47.48 ≈ 1.8 nm of progress.
    const { steps, state } = runPolls([proc], [
      { t: 0, aircraft: [plane('a', 47.45, LON_16C, 0)] },
      { t: 5000, aircraft: [plane('a', 47.465, LON_16C, 0)] },
      { t: 10000, aircraft: [plane('a', 47.48, LON_16C, 0)] },
    ])
    expect(steps[2].state.tracks.a.BANGR9.phase).toBe('confirmed')
    expect(steps[2].activity.BANGR9.hexes).toEqual(['a'])
    expect(state.sidStarAssignments).toEqual({ a: { SID: 'BANGR9' } })
  })

  it('(13) aligned-but-loitering traffic never confirms a SID (no progress)', () => {
    const proc = sid('BANGR9', LON_16C)
    // Aligned with the leg every poll, but stationary — like a circler whose
    // track happens to parallel the SID each time it's sampled.
    const polls: Poll[] = [0, 5000, 10000, 15000, 20000, 25000].map((t) => ({
      t,
      aircraft: [plane('a', 47.45, LON_16C, 0)],
    }))
    const { steps, state } = runPolls([proc], polls)
    expect(state.tracks.a.BANGR9.phase).toBe('candidate')
    expect(steps.every((s) => s.activity.BANGR9 === undefined)).toBe(true)
    expect(steps.every((s) => s.events.every((e) => e.type !== 'confirmed'))).toBe(true)
  })

  it('(14) sibling SIDs sharing a leg: only the closest is shown, one assignment per hex', () => {
    // Two SIDs on the same line — both confirm, only one appears in activity.
    const procs = [sid('BANGR9', LON_16C), sid('ISBRG1', LON_16C)]
    const { steps, state } = runPolls(procs, [
      { t: 0, aircraft: [plane('a', 47.45, LON_16C, 0)] },
      { t: 5000, aircraft: [plane('a', 47.465, LON_16C, 0)] },
      { t: 10000, aircraft: [plane('a', 47.48, LON_16C, 0)] },
    ])
    expect(steps[2].state.tracks.a.BANGR9.phase).toBe('confirmed')
    expect(steps[2].state.tracks.a.ISBRG1.phase).toBe('confirmed')
    const assigned = state.sidStarAssignments.a.SID!
    expect(['BANGR9', 'ISBRG1']).toContain(assigned)
    expect(Object.keys(steps[2].activity)).toEqual([assigned])
    expect(steps[2].activity[assigned].hexes).toEqual(['a'])
  })

  it('(15) SID assignment reassigns after a sustained closer streak on divergence', () => {
    // Parallel SIDs 0.13 nm apart; the plane confirms while between them, then
    // settles clearly onto the second line for 3+ polls.
    const procs = [sid('S1', LON_16C), sid('S2', LON_16L)]
    const between = (LON_16C + LON_16L) / 2 + 0.0004 // nearer S1
    const polls: Poll[] = [
      { t: 0, aircraft: [plane('a', 47.45, between, 0)] },
      { t: 5000, aircraft: [plane('a', 47.465, between, 0)] },
      { t: 10000, aircraft: [plane('a', 47.48, between, 0)] },
      { t: 15000, aircraft: [plane('a', 47.495, LON_16L, 0)] },
      { t: 20000, aircraft: [plane('a', 47.51, LON_16L, 0)] },
      { t: 25000, aircraft: [plane('a', 47.525, LON_16L, 0)] },
    ]
    const { steps, state } = runPolls(procs, polls)
    expect(steps[2].state.sidStarAssignments.a.SID).toBe('S1')
    expect(state.sidStarAssignments.a.SID).toBe('S2')
    expect(Object.keys(steps[5].activity)).toEqual(['S2'])
  })
})

// ── Phase 6: multiple airports at once ──────────────────────────────────────
// Each procedure is matched against its OWN airport's context (looked up by
// proc.icao) and its OWN airport's ATIS. A bbox prefilter skips new-track work
// for out-of-box aircraft without ever changing a result.

interface MultiPoll {
  t: number
  aircraft: InterpolatedAircraft[]
}

function runMulti(
  procedures: Procedure[],
  ctxByKey: Record<string, AirportContext>,
  atisByIcao: Record<string, AtisInfo | null>,
  polls: MultiPoll[],
) {
  let state = initialDetectionState()
  const steps: Step[] = polls.map((poll) => {
    const r = reduceDetection(
      state,
      { nowMs: poll.t, aircraft: poll.aircraft },
      procedures,
      ctxByKey,
      atisByIcao,
      CONFIG,
    )
    state = r.state
    return { state, events: r.events, activity: deriveProcedureActivity(state) }
  })
  return { state, steps }
}

describe('detectionMachine — multi-airport (Phase 6)', () => {
  it('(16) altitude gating uses each procedure’s OWN airport elevation', () => {
    // Two approaches on the identical line, differing only by which airport
    // (icao) they belong to. A plane at 15000 ft baro on that line is only
    // altitude-plausible relative to a high-elevation field:
    //   KAAA elev 0    → agl 15000 (> 10000 ceiling) → altOk false → no track
    //   KBBB elev 8000 → agl  7000 (plausible)        → altOk true  → confirms
    // If the reducer used a single/first ctx for both, they'd behave identically;
    // the divergence proves the ctxByKey[proc.icao] lookup.
    const procGated: Procedure = { ...approach('I16C', LON_16C), id: 'GATED', icao: 'KAAA' }
    const procOk: Procedure = { ...approach('I16C', LON_16C), id: 'OK', icao: 'KBBB' }
    const ctxByKey: Record<string, AirportContext> = {
      KAAA: { lat: 47.45, lon: LON_16C, elevationFt: 0 },
      KBBB: { lat: 47.45, lon: LON_16C, elevationFt: 8000 },
    }
    const highPlane: InterpolatedAircraft = {
      ...plane('a', 47.45, LON_16C),
      altBaro: 15000,
      altGeom: 15000,
    }
    const { state } = runMulti(
      [procGated, procOk],
      ctxByKey,
      { KAAA: null, KBBB: null },
      CONFIRM_TS.map((t) => ({ t, aircraft: [highPlane] })),
    )
    expect(state.tracks.a.OK.phase).toBe('confirmed')
    expect(state.tracks.a.GATED).toBeUndefined()
    expect(state.assignments).toEqual({ a: 'OK' })
  })

  it('(17) each airport’s ATIS selects the in-use type for that airport independently', () => {
    // KAAA ATIS favors ILS on 16C; KBBB ATIS favors RNAV on 16C. Each airport
    // has both an ILS and an RNAV on its runway; a plane over each field confirms
    // both of its approaches, and the per-airport ATIS decides the assignment —
    // opposite winners at the two fields prove atisByIcao[proc.icao] keying.
    const LON_A = LON_16C // -122.31
    const LON_B = -122.1 // ~8.5 nm east; far outside A's boxes and vice versa
    const procAI: Procedure = { ...approach('I16C', LON_A), id: 'AI', icao: 'KAAA' }
    const procAR: Procedure = { ...approach('R16C', LON_A), id: 'AR', icao: 'KAAA' }
    const procBI: Procedure = { ...approach('I16C', LON_B), id: 'BI', icao: 'KBBB' }
    const procBR: Procedure = { ...approach('R16C', LON_B), id: 'BR', icao: 'KBBB' }
    const ctxByKey: Record<string, AirportContext> = {
      KAAA: { lat: 47.45, lon: LON_A, elevationFt: 0 },
      KBBB: { lat: 47.45, lon: LON_B, elevationFt: 0 },
    }
    const atisByIcao = { KAAA: atis({ '16C': ['I'] }), KBBB: atis({ '16C': ['R'] }) }
    const { state } = runMulti(
      [procAI, procAR, procBI, procBR],
      ctxByKey,
      atisByIcao,
      CONFIRM_TS.map((t) => ({
        t,
        aircraft: [plane('a', 47.45, LON_A), plane('b', 47.45, LON_B)],
      })),
    )
    // Airport A prefers ILS → a assigned AI; airport B prefers RNAV → b assigned BR.
    expect(state.assignments).toEqual({ a: 'AI', b: 'BR' })
  })

  it('(18) removing an airport prunes only its tracks (pruneDetectionState)', () => {
    const mk = (procId: string): ProcTrack => ({
      procId,
      phase: 'confirmed',
      firstMatchMs: 0,
      lastMatchMs: 10000,
      matchCount: 3,
      lastCrossTrackNm: 0.1,
      firstAlongTrackNm: 0,
      lastAlongTrackNm: 2,
      preMapSeen: true,
      closerStreak: 0,
    })
    const keepTrack = mk('KAAA-APPROACH-I16C')
    const state: DetectionState = {
      tracks: {
        a: { 'KAAA-APPROACH-I16C': keepTrack, 'KBBB-APPROACH-I16C': mk('KBBB-APPROACH-I16C') },
        b: { 'KBBB-SID-EXIT1': mk('KBBB-SID-EXIT1') },
      },
      assignments: { a: 'KAAA-APPROACH-I16C', c: 'KBBB-APPROACH-I16C' },
      sidStarAssignments: {
        a: { SID: 'KAAA-SID-DEP1', STAR: 'KBBB-STAR-ARR1' },
        b: { SID: 'KBBB-SID-EXIT1' },
      },
    }
    // KBBB removed → keep only KAAA's procedure ids.
    const keep = new Set(['KAAA-APPROACH-I16C', 'KAAA-SID-DEP1'])
    const pruned = pruneDetectionState(state, keep)

    // KAAA survives; KBBB is gone everywhere.
    expect(pruned.tracks).toEqual({ a: { 'KAAA-APPROACH-I16C': keepTrack } })
    expect(pruned.assignments).toEqual({ a: 'KAAA-APPROACH-I16C' })
    expect(pruned.sidStarAssignments).toEqual({ a: { SID: 'KAAA-SID-DEP1' } })
    // hex b had only KBBB tracks → dropped entirely (no empty {} left behind).
    expect(pruned.tracks.b).toBeUndefined()
    // Kept track objects are preserved by reference (no needless copy).
    expect(pruned.tracks.a['KAAA-APPROACH-I16C']).toBe(keepTrack)
  })

  it('(18b) pruneDetectionState with all ids kept is a structural no-op', () => {
    const t: ProcTrack = {
      procId: 'KAAA-APPROACH-I16C',
      phase: 'confirmed',
      firstMatchMs: 0,
      lastMatchMs: 10000,
      matchCount: 3,
      lastCrossTrackNm: 0.1,
      firstAlongTrackNm: 0,
      lastAlongTrackNm: 2,
      preMapSeen: true,
      closerStreak: 0,
    }
    const state: DetectionState = {
      tracks: { a: { 'KAAA-APPROACH-I16C': t } },
      assignments: { a: 'KAAA-APPROACH-I16C' },
      sidStarAssignments: { a: { SID: 'KAAA-SID-DEP1' } },
    }
    const pruned = pruneDetectionState(state, new Set(['KAAA-APPROACH-I16C', 'KAAA-SID-DEP1']))
    expect(pruned).toEqual(state)
  })

  it('(19) the bbox prefilter never changes results: an out-of-box aircraft is inert', () => {
    // A plane ~55 nm east of the line is outside the padded box and off the line
    // (no evidence). Adding it must produce a detection state deep-equal to the
    // run without it — the prefilter only skips work.
    const proc = approach('I16C', LON_16C)
    const near = (t: number) => ({ t, aircraft: [plane('a', 47.45, LON_16C)] })
    const nearAndFar = (t: number) => ({
      t,
      aircraft: [plane('a', 47.45, LON_16C), plane('far', 47.45, -121.0)],
    })
    const without = runMulti([proc], { KSEA: CTX }, { KSEA: null }, CONFIRM_TS.map(near))
    const withFar = runMulti([proc], { KSEA: CTX }, { KSEA: null }, CONFIRM_TS.map(nearAndFar))
    expect(withFar.state).toEqual(without.state)
    expect(withFar.state.tracks.far).toBeUndefined()
  })

  it('(20) an existing confirmed track is aged by TTL, never dropped by the prefilter', () => {
    // Confirm on the line, then move the SAME hex far outside the padded box and
    // off the line (no evidence). Because the track already exists, the reducer
    // must NOT apply the new-track box gate: the track survives on its TTL and is
    // only lost after DETECT_CONFIRMED_TTL_MS of sustained failure.
    const proc = approach('I16C', LON_16C)
    const polls: MultiPoll[] = [
      ...CONFIRM_TS.map((t) => ({ t, aircraft: [plane('a', 47.45, LON_16C)] })),
      { t: 15000, aircraft: [plane('a', 47.45, -121.0)] }, // out of box, 5 s after last match
      { t: 45000, aircraft: [plane('a', 47.45, -121.0)] }, // 35 s after last match → past TTL
    ]
    const { steps } = runMulti([proc], { KSEA: CTX }, { KSEA: null }, polls)
    // Right after leaving the box: still confirmed and assigned (TTL not lapsed).
    expect(steps[3].state.tracks.a.I16C.phase).toBe('confirmed')
    expect(steps[3].state.assignments).toEqual({ a: 'I16C' })
    // Past the confirmed TTL: dropped with a lost event.
    expect(steps[4].state.tracks.a).toBeUndefined()
    expect(steps[4].state.assignments).toEqual({})
    expect(steps[4].events.some((e) => e.type === 'lost')).toBe(true)
  })
})
