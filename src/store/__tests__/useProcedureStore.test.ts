import { describe, it, expect, beforeEach } from 'vitest'
import { useProcedureStore } from '../useProcedureStore'
import { AUTO_HIDE_DELAY_MS } from '../../config/constants'
import type { Procedure } from '../../types/procedure'
import type { ProcedureActivity } from '../../geo/detectionMachine'

function approach(icao: string, name: string): Procedure {
  return {
    id: `${icao}-${name}`,
    icao,
    name,
    type: 'APPROACH',
    runways: [name.slice(1)],
    waypoints: [],
    symbols: [],
    geojson: { type: 'FeatureCollection', features: [] },
    hasGeometry: true,
    color: '#34d399',
  }
}

function act(hexes: string[], lastActiveMs: number): ProcedureActivity {
  return { hexes, lastActiveMs }
}

const store = () => useProcedureStore.getState()

/** Full reset to the store's initial shape (setProcedures replace-all shim was removed). */
function resetStore() {
  useProcedureStore.setState({
    procedures: [],
    loading: false,
    error: null,
    userToggles: {},
    autoVisible: {},
    autoShownIds: new Set(),
    lastDetectedAt: {},
    detectedHexes: {},
    aircraftAssignments: {},
    detectionHistory: {},
  })
}

describe('useProcedureStore.applyDetection', () => {
  beforeEach(() => {
    resetStore()
  })

  it('auto-shows a detected procedure and records its hexes/assignments', () => {
    store().mergeAirportProcedures('KSEA', [approach('KSEA', 'I16C')])
    store().applyDetection({ 'KSEA-I16C': act(['a'], 1000) }, { a: 'KSEA-I16C' }, 1000)
    expect(store().isVisible('KSEA-I16C')).toBe(true)
    expect(store().detectedHexes['KSEA-I16C']).toEqual(['a'])
    expect(store().aircraftAssignments).toEqual({ a: 'KSEA-I16C' })
  })

  it('auto-hides only after AUTO_HIDE_DELAY_MS with no traffic', () => {
    store().mergeAirportProcedures('KSEA', [approach('KSEA', 'I16C')])
    store().applyDetection({ 'KSEA-I16C': act(['a'], 1000) }, { a: 'KSEA-I16C' }, 1000)

    store().applyDetection({}, {}, 1000 + AUTO_HIDE_DELAY_MS - 1)
    expect(store().isVisible('KSEA-I16C')).toBe(true)

    store().applyDetection({}, {}, 1000 + AUTO_HIDE_DELAY_MS + 1)
    expect(store().isVisible('KSEA-I16C')).toBe(false)
  })

  it('immediately hides a same-runway sibling that lost all its traffic', () => {
    store().mergeAirportProcedures('KSEA', [approach('KSEA', 'I16C'), approach('KSEA', 'R16C')])
    store().applyDetection(
      { 'KSEA-I16C': act(['a'], 1000), 'KSEA-R16C': act(['b'], 1000) },
      { a: 'KSEA-I16C', b: 'KSEA-R16C' },
      1000,
    )
    expect(store().isVisible('KSEA-R16C')).toBe(true)

    // 1 s later: R16C has no traffic but the same-runway I16C still does.
    store().applyDetection({ 'KSEA-I16C': act(['a'], 2000) }, { a: 'KSEA-I16C' }, 2000)
    expect(store().isVisible('KSEA-R16C')).toBe(false)
    expect(store().isVisible('KSEA-I16C')).toBe(true)
  })

  it('preserves the detectedHexes array reference when unchanged', () => {
    store().mergeAirportProcedures('KSEA', [approach('KSEA', 'I16C')])
    store().applyDetection({ 'KSEA-I16C': act(['a', 'b'], 1000) }, {}, 1000)
    const ref1 = store().detectedHexes['KSEA-I16C']
    store().applyDetection({ 'KSEA-I16C': act(['a', 'b'], 2000) }, {}, 2000)
    expect(store().detectedHexes['KSEA-I16C']).toBe(ref1)
  })

  it('appends zero-count history samples once a procedure goes idle', () => {
    store().mergeAirportProcedures('KSEA', [approach('KSEA', 'I16C')])
    store().applyDetection({ 'KSEA-I16C': act(['a', 'b'], 1000) }, {}, 1000)
    expect(store().detectionHistory['KSEA-I16C']).toEqual([{ t: 1000, count: 2 }])

    // Traffic leaves: the next polls must record zeros so the rolling average
    // decays instead of holding the last nonzero counts for the whole window.
    store().applyDetection({}, {}, 2000)
    expect(store().detectionHistory['KSEA-I16C']).toEqual([
      { t: 1000, count: 2 },
      { t: 2000, count: 0 },
    ])
  })

  it('does not override an explicit user toggle', () => {
    store().mergeAirportProcedures('KSEA', [approach('KSEA', 'I16C')])
    store().setUserToggle('KSEA-I16C', false)
    store().applyDetection({ 'KSEA-I16C': act(['a'], 1000) }, { a: 'KSEA-I16C' }, 1000)
    expect(store().isVisible('KSEA-I16C')).toBe(false)
  })
})

describe('useProcedureStore.mergeAirportProcedures / removeAirportProcedures', () => {
  beforeEach(() => {
    resetStore()
  })

  it('adding airport B leaves airport A\'s procedures and detection state untouched', () => {
    store().mergeAirportProcedures('KSEA', [approach('KSEA', 'I16C')])
    store().applyDetection({ 'KSEA-I16C': act(['a'], 1000) }, { a: 'KSEA-I16C' }, 1000)
    store().setUserToggle('KSEA-I16C', true)

    store().mergeAirportProcedures('KPAE', [approach('KPAE', 'I16')])

    expect(store().procedures.map((p) => p.id).sort()).toEqual(['KPAE-I16', 'KSEA-I16C'])
    expect(store().userToggles['KSEA-I16C']).toBe(true)
    expect(store().autoVisible['KSEA-I16C']).toBe(true)
    expect(store().detectedHexes['KSEA-I16C']).toEqual(['a'])
    expect(store().aircraftAssignments).toEqual({ a: 'KSEA-I16C' })
    expect(store().lastDetectedAt['KSEA-I16C']).toBe(1000)
  })

  it('re-merging airport A replaces only A\'s rows and clears only A\'s per-id entries', () => {
    store().mergeAirportProcedures('KSEA', [approach('KSEA', 'I16C')])
    store().mergeAirportProcedures('KPAE', [approach('KPAE', 'I16')])
    store().applyDetection(
      { 'KSEA-I16C': act(['a'], 1000), 'KPAE-I16': act(['b'], 1000) },
      { a: 'KSEA-I16C', b: 'KPAE-I16' },
      1000,
    )
    store().setUserToggle('KSEA-I16C', true)
    store().setUserToggle('KPAE-I16', false)

    // Re-merge KSEA with a renamed procedure — the old KSEA-I16C row and its
    // per-id state must vanish, while KPAE's survive completely untouched.
    store().mergeAirportProcedures('KSEA', [approach('KSEA', 'R34')])

    const ids = store().procedures.map((p) => p.id).sort()
    expect(ids).toEqual(['KPAE-I16', 'KSEA-R34'])
    expect(store().userToggles['KSEA-I16C']).toBeUndefined()
    expect(store().autoVisible['KSEA-I16C']).toBeUndefined()
    expect(store().detectedHexes['KSEA-I16C']).toBeUndefined()
    expect(store().aircraftAssignments.a).toBeUndefined()
    expect(store().lastDetectedAt['KSEA-I16C']).toBeUndefined()

    expect(store().userToggles['KPAE-I16']).toBe(false)
    expect(store().aircraftAssignments.b).toBe('KPAE-I16')
    expect(store().detectedHexes['KPAE-I16']).toEqual(['b'])
  })

  it('removeAirportProcedures(A) drops only A, leaving B fully intact', () => {
    store().mergeAirportProcedures('KSEA', [approach('KSEA', 'I16C')])
    store().mergeAirportProcedures('KPAE', [approach('KPAE', 'I16')])
    store().applyDetection(
      { 'KSEA-I16C': act(['a'], 1000), 'KPAE-I16': act(['b'], 1000) },
      { a: 'KSEA-I16C', b: 'KPAE-I16' },
      1000,
    )
    store().setUserToggle('KPAE-I16', true)

    store().removeAirportProcedures('KSEA')

    expect(store().procedures.map((p) => p.id)).toEqual(['KPAE-I16'])
    expect(store().userToggles['KSEA-I16C']).toBeUndefined()
    expect(store().detectedHexes['KSEA-I16C']).toBeUndefined()
    expect(store().aircraftAssignments.a).toBeUndefined()

    expect(store().userToggles['KPAE-I16']).toBe(true)
    expect(store().detectedHexes['KPAE-I16']).toEqual(['b'])
    expect(store().aircraftAssignments.b).toBe('KPAE-I16')
  })

  it('removeAirportProcedures is a no-op for an airport with no rows', () => {
    store().mergeAirportProcedures('KSEA', [approach('KSEA', 'I16C')])
    const before = store().procedures
    store().removeAirportProcedures('KPAE')
    expect(store().procedures).toBe(before)
  })

  it('key matching is case-insensitive', () => {
    store().mergeAirportProcedures('KSEA', [approach('KSEA', 'I16C')])
    store().mergeAirportProcedures('ksea', [approach('KSEA', 'R34')])
    expect(store().procedures.map((p) => p.id)).toEqual(['KSEA-R34'])
  })
})
