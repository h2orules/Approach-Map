import { describe, it, expect, beforeEach } from 'vitest'
import { usePathStore } from '../usePathStore'
import type { PredictedPath, HoldEntryPrediction, AircraftAlert, ConflictPair } from '../../types/path'

function makePrediction(hex: string): PredictedPath {
  return { hex, mode: 'straight', points: [{ lon: -122.3, lat: 47.9, tSec: 5, altFt: 3000 }] }
}

function makeHoldEntry(hex: string): HoldEntryPrediction {
  return {
    hex,
    specKey: 'KPAE-V-A|PAE',
    entry: 'direct',
    path: [[-122.3, 47.9]],
    lastQualifiedMs: 1000,
    divergedPolls: 0,
    crossedFix: false,
  }
}

function makeAlert(otherHex: string): AircraftAlert {
  return { kind: 'traffic', tier: 'alert', otherHex }
}

function makeConflict(hexA: string, hexB: string): ConflictPair {
  return { hexA, hexB, tier: 'alert', cpaTimeS: 40, cpaNm: 1.5, cpaDAltFt: 600 }
}

function resultsFor(hex: string) {
  return {
    predictions: new Map([[hex, makePrediction(hex)]]),
    holdEntries: new Map([[hex, makeHoldEntry(hex)]]),
    alerts: new Map([[hex, makeAlert('zzzzzz')]]),
    conflictPairs: [makeConflict(hex, 'zzzzzz')],
    forcedVisibleHexes: new Set<string>(),
  }
}

describe('usePathStore', () => {
  beforeEach(() => {
    usePathStore.setState({
      predictions: new Map(),
      holdEntries: new Map(),
      alerts: new Map(),
      conflictPairs: [],
      pathRevision: 0,
    })
  })

  it('setResults bumps pathRevision exactly once per call', () => {
    expect(usePathStore.getState().pathRevision).toBe(0)
    usePathStore.getState().setResults(resultsFor('a1b2c3'))
    expect(usePathStore.getState().pathRevision).toBe(1)
    usePathStore.getState().setResults(resultsFor('a1b2c3'))
    expect(usePathStore.getState().pathRevision).toBe(2)
  })

  it('setResults replaces all collections wholesale, dropping stale hexes', () => {
    usePathStore.getState().setResults(resultsFor('a1b2c3'))
    usePathStore.getState().setResults(resultsFor('d4e5f6'))

    const s = usePathStore.getState()
    expect(s.predictions.has('a1b2c3')).toBe(false)
    expect(s.predictions.has('d4e5f6')).toBe(true)
    expect(s.holdEntries.has('a1b2c3')).toBe(false)
    expect(s.holdEntries.has('d4e5f6')).toBe(true)
    expect(s.alerts.has('a1b2c3')).toBe(false)
    expect(s.alerts.has('d4e5f6')).toBe(true)
    expect(s.conflictPairs).toHaveLength(1)
    expect(s.conflictPairs[0].hexA).toBe('d4e5f6')
  })

  it('clear empties every collection and bumps pathRevision', () => {
    usePathStore.getState().setResults(resultsFor('a1b2c3'))
    expect(usePathStore.getState().pathRevision).toBe(1)

    usePathStore.getState().clear()

    const s = usePathStore.getState()
    expect(s.predictions.size).toBe(0)
    expect(s.holdEntries.size).toBe(0)
    expect(s.alerts.size).toBe(0)
    expect(s.conflictPairs).toEqual([])
    expect(s.pathRevision).toBe(2)
  })
})
