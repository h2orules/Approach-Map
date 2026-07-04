import { describe, it, expect, beforeEach } from 'vitest'
import { useSelectionStore, selectedHexOf } from '../useSelectionStore'

describe('useSelectionStore', () => {
  beforeEach(() => {
    useSelectionStore.setState({ selected: null })
  })

  it('select sets the selection', () => {
    useSelectionStore.getState().select({ kind: 'aircraft', hex: 'abc123' })
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'aircraft', hex: 'abc123' })
  })

  it('toggle-same-clears', () => {
    const sel = { kind: 'aircraft' as const, hex: 'abc123' }
    useSelectionStore.getState().select(sel)
    useSelectionStore.getState().toggle(sel)
    expect(useSelectionStore.getState().selected).toBeNull()
  })

  it('toggle-different-moves', () => {
    useSelectionStore.getState().select({ kind: 'aircraft', hex: 'abc123' })
    useSelectionStore.getState().toggle({ kind: 'aircraft', hex: 'def456' })
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'aircraft', hex: 'def456' })
  })

  it('toggle-across-kinds-moves', () => {
    useSelectionStore.getState().select({ kind: 'aircraft', hex: 'abc123' })
    useSelectionStore.getState().toggle({ kind: 'approach', procedureId: 'KSEA_ILS16L' })
    expect(useSelectionStore.getState().selected).toEqual({
      kind: 'approach',
      procedureId: 'KSEA_ILS16L',
    })
  })

  it('clear resets the selection', () => {
    useSelectionStore.getState().select({ kind: 'approach', procedureId: 'KSEA_ILS16L' })
    useSelectionStore.getState().clear()
    expect(useSelectionStore.getState().selected).toBeNull()
  })

  it('selectedHexOf returns hex for aircraft selection', () => {
    expect(selectedHexOf({ kind: 'aircraft', hex: 'abc123' })).toBe('abc123')
  })

  it('selectedHexOf returns null for approach selection', () => {
    expect(selectedHexOf({ kind: 'approach', procedureId: 'KSEA_ILS16L' })).toBeNull()
  })

  it('selectedHexOf returns null for null selection', () => {
    expect(selectedHexOf(null)).toBeNull()
  })
})
