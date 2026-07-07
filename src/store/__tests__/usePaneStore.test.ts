import { describe, it, expect, beforeEach } from 'vitest'
import { usePaneStore, deriveMode, PANE_OVERLAY_BREAKPOINT_PX } from '../usePaneStore'

describe('deriveMode', () => {
  it('is push above the phone breakpoint', () => {
    expect(deriveMode(1024)).toBe('push')
    expect(deriveMode(PANE_OVERLAY_BREAKPOINT_PX + 1)).toBe('push')
  })

  it('is overlay at or below the phone breakpoint', () => {
    expect(deriveMode(PANE_OVERLAY_BREAKPOINT_PX)).toBe('overlay')
    expect(deriveMode(375)).toBe('overlay')
  })
})

describe('usePaneStore', () => {
  beforeEach(() => {
    localStorage.clear()
    usePaneStore.setState({ collapsed: false, sheetOpen: false, clutterHintDismissed: false })
  })

  it('toggleCollapsed flips collapsed', () => {
    usePaneStore.getState().toggleCollapsed()
    expect(usePaneStore.getState().collapsed).toBe(true)
    usePaneStore.getState().toggleCollapsed()
    expect(usePaneStore.getState().collapsed).toBe(false)
  })

  it('toggleSheetOpen and setSheetOpen control sheetOpen independently of collapsed', () => {
    usePaneStore.getState().toggleSheetOpen()
    expect(usePaneStore.getState().sheetOpen).toBe(true)
    usePaneStore.getState().setSheetOpen(false)
    expect(usePaneStore.getState().sheetOpen).toBe(false)
    expect(usePaneStore.getState().collapsed).toBe(false)
  })

  it('dismissClutterHint sets the dismissal flag', () => {
    expect(usePaneStore.getState().clutterHintDismissed).toBe(false)
    usePaneStore.getState().dismissClutterHint()
    expect(usePaneStore.getState().clutterHintDismissed).toBe(true)
  })

  it('persists only collapsed, not sheetOpen or clutterHintDismissed', () => {
    usePaneStore.getState().toggleCollapsed()
    usePaneStore.getState().toggleSheetOpen()
    usePaneStore.getState().dismissClutterHint()

    const raw = localStorage.getItem('approach-map-pane')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.state).toEqual({ collapsed: true })
  })
})
