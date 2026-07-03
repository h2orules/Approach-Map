/** Total number of discrete positions on the altitude slider (0–19). */
export const NUM_POSITIONS = 20

/**
 * Convert a slider position to a display label.
 *
 *   0      → "SFC"
 *   1–17   → "1k" … "17k"
 *   18     → "<18k"
 *   19     → "Class A"
 */
export function positionLabel(pos: number): string {
  if (pos === 0) return 'SFC'
  if (pos <= 17) return `${pos}k`
  if (pos === 18) return '<18k'
  return 'Cls A'
}

/**
 * Minimum altitude (ft) represented by a slider position when used as the
 * LOWER handle.  Position 19 (Class A) → 18 000 ft so only Class A traffic
 * is included.
 */
export function positionToMinFt(pos: number): number {
  if (pos === 0) return 0
  if (pos <= 17) return pos * 1000
  if (pos === 18) return 17999
  return 18000 // pos === 19 — Class A floor
}

/**
 * Maximum altitude (ft) represented by a slider position when used as the
 * UPPER handle.  Position 19 (Class A) → 60 000 ft so all Class A traffic
 * is included.
 */
export function positionToMaxFt(pos: number): number {
  if (pos === 0) return 0
  if (pos <= 17) return pos * 1000
  if (pos === 18) return 17999
  return 60000 // pos === 19 — Class A ceiling
}
