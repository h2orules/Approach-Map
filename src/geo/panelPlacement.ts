export interface Rect { x: number; y: number; w: number; h: number }

function containsPoint(r: Rect, p: { x: number; y: number }): boolean {
  // Half-open on both axes: [x, x+w) x [y, y+h).
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h
}

function overlaps(a: Rect, b: Rect): boolean {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return ox * oy > 0
}

const RESERVED_PENALTY = 50

/**
 * Score each candidate panel rect by how many obstacle points it covers
 * (1 point each) plus a heavy penalty (50) for each reserved rect it
 * overlaps at all, and return the index of the lowest-scoring candidate.
 * Ties resolve to the first (lowest-index) candidate.
 */
export function pickPanelAnchor(
  candidates: Rect[],
  obstaclePts: Array<{ x: number; y: number }>,
  reservedRects: Rect[],
): number {
  let bestIdx = 0
  let bestScore = Infinity

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    let score = 0
    for (const p of obstaclePts) {
      if (containsPoint(c, p)) score += 1
    }
    for (const r of reservedRects) {
      if (overlaps(c, r)) score += RESERVED_PENALTY
    }
    if (score < bestScore) {
      bestScore = score
      bestIdx = i
    }
  }

  return bestIdx
}
