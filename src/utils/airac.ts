import { AIRAC_REFERENCE_DATE, AIRAC_CYCLE_DAYS } from '../config/constants'

const CYCLE_MS = AIRAC_CYCLE_DAYS * 24 * 60 * 60 * 1000
const REF_MS = new Date(AIRAC_REFERENCE_DATE).getTime()

export function currentCycleEffectiveDate(now: Date = new Date()): Date {
  const elapsed = now.getTime() - REF_MS
  const n = Math.floor(elapsed / CYCLE_MS)
  return new Date(REF_MS + n * CYCLE_MS)
}

export function nextCycleDate(now: Date = new Date()): Date {
  return new Date(currentCycleEffectiveDate(now).getTime() + CYCLE_MS)
}

export function cifpUrl(effectiveDate: Date): string {
  // FAA uses YYMMDD format, e.g. CIFP_260611.zip
  const d = effectiveDate.toISOString().slice(2, 10).replace(/-/g, '')
  return `/api/faa-cifp/CIFP_${d}.zip`
}

export function formatCycleDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function isCycleStale(storedDateStr: string | null, now: Date = new Date()): boolean {
  if (!storedDateStr) return true
  const stored = new Date(storedDateStr).getTime()
  const current = currentCycleEffectiveDate(now).getTime()
  return stored < current
}
