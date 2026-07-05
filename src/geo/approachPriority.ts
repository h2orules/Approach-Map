import type { Procedure } from '../types/procedure'
import type { AtisInfo } from '../api/datis'

// Static fallback priority when ATIS is unavailable or doesn't list the type.
// Higher = preferred. I(LS) > R(NAV) > H(RNP/other) > L(OC).
const STATIC_PRIORITY: Record<string, number> = { I: 4, R: 3, H: 2, L: 1 }

/**
 * Extract the runway designator from an approach procedure name.
 * CIFP names: I34L, R34C, H16R, L28, VDME-A.
 * Returns e.g. "34L", "16R", or all runways joined for non-runway-specific
 * approaches (circling, VOR/DME-A), so those still group together.
 */
export function approachRunwayKey(proc: Procedure): string {
  const m = proc.name.match(/^[A-Z](\d{2}[LRC]?)/)
  if (m) return m[1]
  return [...proc.runways].sort().join(',')
}

/**
 * Priority score for an approach, incorporating D-ATIS preferences when
 * available. ATIS-listed types receive a boosted score (100 − position) so they
 * always outrank types not mentioned in the ATIS; within ATIS entries the
 * original text order is preserved (ILS before LOC when ATIS says "ILS OR LOC").
 * Non-ATIS types fall back to the static I > R > H > L ordering.
 */
export function approachPriority(proc: Procedure, atisInfo: AtisInfo | null): number {
  const prefix = proc.name[0]?.toUpperCase() ?? ''
  const prefs = atisInfo?.runwayPrefs[approachRunwayKey(proc)] ?? []
  const atisIdx = prefs.indexOf(prefix)
  if (atisIdx >= 0) return 100 - atisIdx
  return STATIC_PRIORITY[prefix] ?? 0
}
