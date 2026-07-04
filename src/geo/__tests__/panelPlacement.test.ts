import { describe, it, expect } from 'vitest'
import { pickPanelAnchor } from '../panelPlacement'
import type { Rect } from '../panelPlacement'

describe('pickPanelAnchor', () => {
  it('counts obstacle points inside a candidate, half-open on the right/bottom edges', () => {
    const r: Rect = { x: 0, y: 0, w: 10, h: 10 }
    // Inside (top-left corner, included by half-open range).
    const inside = { x: 0, y: 0 }
    // On the right/bottom edge — excluded (x+w, y+h are exclusive).
    const onRightEdge = { x: 10, y: 5 }
    const onBottomEdge = { x: 5, y: 10 }
    // Clearly outside.
    const outside = { x: 20, y: 20 }

    const other: Rect = { x: 100, y: 100, w: 10, h: 10 } // far away, always empty
    const idx = pickPanelAnchor([r, other], [inside, onRightEdge, onBottomEdge, outside], [])
    // r has 1 point (inside); other has 0 → other should win (lower score).
    expect(idx).toBe(1)
  })

  it('penalizes any positive-area overlap with a reserved rect over raw point count', () => {
    const busyButClear: Rect = { x: 0, y: 0, w: 10, h: 10 } // 3 obstacle points, no reserved overlap
    const quietButReserved: Rect = { x: 50, y: 50, w: 10, h: 10 } // 0 obstacle points, overlaps reserved
    const obstacles = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]
    const reserved: Rect[] = [{ x: 55, y: 55, w: 5, h: 5 }]

    const idx = pickPanelAnchor([busyButClear, quietButReserved], obstacles, reserved)
    expect(idx).toBe(0) // 3 < 50, so the busy-but-unreserved candidate wins
  })

  it('does not penalize a reserved rect that does not overlap (zero intersection area)', () => {
    const touchingEdge: Rect = { x: 0, y: 0, w: 10, h: 10 }
    const reserved: Rect[] = [{ x: 10, y: 0, w: 10, h: 10 }] // shares only the edge, zero area overlap
    const idx = pickPanelAnchor([touchingEdge], [], reserved)
    expect(idx).toBe(0)
  })

  it('breaks ties by returning the first candidate index', () => {
    const a: Rect = { x: 0, y: 0, w: 10, h: 10 }
    const b: Rect = { x: 100, y: 100, w: 10, h: 10 }
    const c: Rect = { x: 200, y: 200, w: 10, h: 10 }
    expect(pickPanelAnchor([a, b, c], [], [])).toBe(0)
  })

  it('returns 0 when there are no obstacles or reserved rects at all', () => {
    const a: Rect = { x: 0, y: 0, w: 10, h: 10 }
    const b: Rect = { x: 100, y: 100, w: 10, h: 10 }
    expect(pickPanelAnchor([a, b], [], [])).toBe(0)
  })
})
