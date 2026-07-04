import { AIRAC_REFERENCE_DATE, AIRAC_CYCLE_DAYS } from '../config/constants'
import { currentCycleEffectiveDate } from './airac'

// Reuse the same AIRAC epoch/period constants and cycle math as airac.ts —
// do not duplicate them. FAA d-TPP cycle numbers are `YY` + a zero-padded
// ordinal of the AIRAC cycle within its own calendar year (13 cycles most
// years, since 365 / 28 ≈ 13.04).
const CYCLE_MS = AIRAC_CYCLE_DAYS * 24 * 60 * 60 * 1000
const REF_MS = new Date(AIRAC_REFERENCE_DATE).getTime()

// The AIRAC reference cycle (effective 2024-01-25) is n = 0. Verified math for
// the cases exercised in the unit tests, counting whole 28-day steps from the
// reference date:
//
//   n=0  2024-01-25  (first 2024 cycle -> ordinal 1  -> "2401")
//   n=1  2024-02-22  (ordinal 2  -> "2402")
//   ...
//   n=12 2024-12-26  (13th and last 2024 cycle -> "2413")
//   n=13 2025-01-23  (first 2025 cycle -> "2501")
//   ...
//   n=25 2025-12-25  (13th and last 2025 cycle -> "2513")
//   n=26 2026-01-22  (first 2026 cycle -> "2601")
//   n=27 2026-02-19  ("2602")
//   n=28 2026-03-19  ("2603")
//   n=29 2026-04-16  ("2604")
//   n=30 2026-05-14  ("2605")
//   n=31 2026-06-11  (elapsed = 868 days = 31 * 28 exactly -> ordinal 6 -> "2606")
export function dtppCycle(effectiveDate: Date): string {
  // Use the *cycle's own* effective date/year, not the queried date's — this
  // is the convention for the January edge case: a query date early in
  // January can still fall inside the previous AIRAC cycle (whose effective
  // date, and therefore year/ordinal, is in the prior December), and the
  // returned d-TPP cycle number should reflect that prior cycle, e.g.
  // dtppCycle(2025-01-03) -> "2413" (still the 2024-12-26 cycle), not "2501".
  const current = currentCycleEffectiveDate(effectiveDate)
  const year = current.getUTCFullYear()
  const n = Math.round((current.getTime() - REF_MS) / CYCLE_MS)

  let ordinal = 1
  for (let idx = n - 1; idx >= 0; idx--) {
    const cycleDate = new Date(REF_MS + idx * CYCLE_MS)
    if (cycleDate.getUTCFullYear() !== year) break
    ordinal++
  }

  const yy = String(year % 100).padStart(2, '0')
  const ordinalStr = String(ordinal).padStart(2, '0')
  return `${yy}${ordinalStr}`
}
