/**
 * Rolling-window sample history for per-procedure detected-aircraft counts.
 * Powers the "which TAA/MSA sector is currently relevant" ranking in
 * `src/geo/safeAltitude.ts` (chooseSafeAltitudeArea) via averageCount().
 */
export interface DetectionSample {
  t: number
  count: number
}

/**
 * Returns a NEW history object: every existing sample array is pruned to
 * `(nowMs - windowMs, nowMs]`, and a fresh sample is appended for every id
 * present in `counts` (including zeros). Ids left with no samples after
 * pruning, and no new count, are dropped entirely. The input `history`
 * object and its arrays are never mutated.
 */
export function appendSamples(
  history: Record<string, DetectionSample[]>,
  counts: Record<string, number>,
  nowMs: number,
  windowMs: number,
): Record<string, DetectionSample[]> {
  const cutoff = nowMs - windowMs
  const ids = new Set([...Object.keys(history), ...Object.keys(counts)])
  const next: Record<string, DetectionSample[]> = {}

  for (const id of ids) {
    const prev = history[id] ?? []
    const pruned = prev.filter((sample) => sample.t > cutoff)
    const hasNewCount = Object.prototype.hasOwnProperty.call(counts, id)
    if (hasNewCount) pruned.push({ t: nowMs, count: counts[id] })
    if (pruned.length > 0) next[id] = pruned
  }

  return next
}

/** Mean of in-window sample counts. Empty/undefined history → 0. */
export function averageCount(
  samples: DetectionSample[] | undefined,
  nowMs: number,
  windowMs: number,
): number {
  if (!samples || samples.length === 0) return 0
  const cutoff = nowMs - windowMs
  const inWindow = samples.filter((sample) => sample.t > cutoff && sample.t <= nowMs)
  if (inWindow.length === 0) return 0
  const sum = inWindow.reduce((acc, sample) => acc + sample.count, 0)
  return sum / inWindow.length
}
