import { describe, it, expect, beforeEach } from 'vitest'
import { useProcedureStore } from '../useProcedureStore'
import { AUTO_HIDE_DELAY_MS } from '../../config/constants'
import type { Procedure } from '../../types/procedure'
import type { ProcedureActivity } from '../../geo/detectionMachine'

function approach(name: string): Procedure {
  return {
    id: name,
    icao: 'KSEA',
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

describe('useProcedureStore.applyDetection', () => {
  beforeEach(() => {
    useProcedureStore.getState().setProcedures([])
  })

  it('auto-shows a detected procedure and records its hexes/assignments', () => {
    store().setProcedures([approach('I16C')])
    store().applyDetection({ I16C: act(['a'], 1000) }, { a: 'I16C' }, 1000)
    expect(store().isVisible('I16C')).toBe(true)
    expect(store().detectedHexes.I16C).toEqual(['a'])
    expect(store().aircraftAssignments).toEqual({ a: 'I16C' })
  })

  it('auto-hides only after AUTO_HIDE_DELAY_MS with no traffic', () => {
    store().setProcedures([approach('I16C')])
    store().applyDetection({ I16C: act(['a'], 1000) }, { a: 'I16C' }, 1000)

    store().applyDetection({}, {}, 1000 + AUTO_HIDE_DELAY_MS - 1)
    expect(store().isVisible('I16C')).toBe(true)

    store().applyDetection({}, {}, 1000 + AUTO_HIDE_DELAY_MS + 1)
    expect(store().isVisible('I16C')).toBe(false)
  })

  it('immediately hides a same-runway sibling that lost all its traffic', () => {
    store().setProcedures([approach('I16C'), approach('R16C')])
    store().applyDetection(
      { I16C: act(['a'], 1000), R16C: act(['b'], 1000) },
      { a: 'I16C', b: 'R16C' },
      1000,
    )
    expect(store().isVisible('R16C')).toBe(true)

    // 1 s later: R16C has no traffic but the same-runway I16C still does.
    store().applyDetection({ I16C: act(['a'], 2000) }, { a: 'I16C' }, 2000)
    expect(store().isVisible('R16C')).toBe(false)
    expect(store().isVisible('I16C')).toBe(true)
  })

  it('preserves the detectedHexes array reference when unchanged', () => {
    store().setProcedures([approach('I16C')])
    store().applyDetection({ I16C: act(['a', 'b'], 1000) }, {}, 1000)
    const ref1 = store().detectedHexes.I16C
    store().applyDetection({ I16C: act(['a', 'b'], 2000) }, {}, 2000)
    expect(store().detectedHexes.I16C).toBe(ref1)
  })

  it('does not override an explicit user toggle', () => {
    store().setProcedures([approach('I16C')])
    store().setUserToggle('I16C', false)
    store().applyDetection({ I16C: act(['a'], 1000) }, { a: 'I16C' }, 1000)
    expect(store().isVisible('I16C')).toBe(false)
  })
})
