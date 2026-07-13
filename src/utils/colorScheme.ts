import type { Procedure, ProcedureType } from '../types/procedure'

/**
 * 2D procedure-color scheme: airport → hue family (a trio of per-type shade
 * ramps), procedure → a shade cycled within its type's ramp. Deterministic and
 * pure (no module-level mutable state) so N airports can be colored
 * independently and repeatably.
 *
 * Slot 0 reproduces the original single-airport palette EXACTLY (cyan SIDs /
 * indigo STARs / emerald approaches), so the one-airport look is unchanged.
 * Slots 1–4 are distinct trios for additional airports; each keeps its three
 * procedure types in different hues so type stays readable within an airport,
 * while the family shift keeps airports distinguishable from one another.
 * All ramps avoid the reserved aircraft (#f59e0b), active-segment (#ff2bd6),
 * highlight (#facc15), centerline (#6b7280) and runway (#64748b) colors, as
 * well as the traffic/terrain alert chrome — ALERT_AMBER (#fbbf24) and
 * WARNING_RED (#ef4444), which live in src/config/constants.ts.
 */
export const PROCEDURE_COLOR_FAMILIES: ReadonlyArray<Record<ProcedureType, readonly string[]>> = [
  {
    // slot 0 — cyan / indigo / emerald (original palette; do not change)
    SID: ['#22d3ee', '#06b6d4', '#0891b2', '#0e7490', '#155e75'],
    STAR: ['#818cf8', '#6366f1', '#4f46e5', '#4338ca', '#3730a3'],
    APPROACH: ['#34d399', '#10b981', '#059669', '#047857', '#065f46'],
  },
  {
    // slot 1 — orange / rose / lime
    SID: ['#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c'],
    STAR: ['#fda4af', '#fb7185', '#f43f5e', '#e11d48', '#be123c'],
    APPROACH: ['#bef264', '#a3e635', '#84cc16', '#65a30d', '#4d7c0f'],
  },
  {
    // slot 2 — violet / fuchsia / teal
    SID: ['#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9'],
    STAR: ['#f0abfc', '#e879f9', '#d946ef', '#c026d3', '#a21caf'],
    APPROACH: ['#5eead4', '#2dd4bf', '#14b8a6', '#0d9488', '#0f766e'],
  },
  {
    // slot 3 — sky / pink / green
    SID: ['#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7', '#0369a1'],
    STAR: ['#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d'],
    APPROACH: ['#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d'],
  },
  {
    // slot 4 — blue / red / yellow-green
    SID: ['#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8'],
    STAR: ['#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c'],
    APPROACH: ['#d9f99d', '#bef264', '#a3e635', '#84cc16', '#65a30d'],
  },
]

function hashKey(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * Assign colors to one airport's procedures. `airportSlot` selects the hue
 * family (insertion order among active airports, wrapped); pass a negative slot
 * to derive it deterministically from `key` instead. Pure — returns new
 * Procedure objects with `color` set, cycling shades per procedure type in the
 * order given.
 */
export function assignProcedureColors(
  key: string,
  procs: Procedure[],
  airportSlot: number,
): Procedure[] {
  const familyIdx =
    airportSlot >= 0
      ? airportSlot % PROCEDURE_COLOR_FAMILIES.length
      : hashKey(key) % PROCEDURE_COLOR_FAMILIES.length
  const family = PROCEDURE_COLOR_FAMILIES[familyIdx]
  const counters: Record<ProcedureType, number> = { SID: 0, STAR: 0, APPROACH: 0 }
  return procs.map((p) => {
    const ramp = family[p.type]
    const color = ramp[counters[p.type]++ % ramp.length]
    return { ...p, color }
  })
}

export const AIRCRAFT_COLOR = '#f59e0b'
export const ACTIVE_PROCEDURE_HIGHLIGHT = '#facc15'
// Magenta highlight for the procedure segment the selected aircraft is flying,
// matching the look of a GPS/FMS moving map. No procedure palette uses this hue.
export const ACTIVE_SEGMENT_COLOR = '#ff2bd6'
export const EXTENDED_CENTERLINE_COLOR = '#6b7280'
// Slate-400 — noticeably lighter than the dark basemap so runways read clearly.
export const RUNWAY_FILL_COLOR = '#64748b'

// ── Aircraft altitude colour ─────────────────────────────────────────────────

type RGB = [number, number, number]

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}

function lerp3(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/**
 * Heatmap stops below Class A: brick red-brown at SFC → light sky near
 * 18 000 ft, walking through vermillion/orange/amber/gold/yellow/chartreuse/
 * lime/green/emerald/teal/cyan.
 *
 * Below 3 000 ft (takeoff, landing, traffic-pattern, and maneuvering
 * altitudes) stops sit every 200 ft, spending the entire warm arc there so a
 * 200 ft change reads as a small-but-visible shift and a 600 ft change (e.g.
 * 800 ft pattern work vs 1 400 ft transit) is unmistakable. From
 * 3 000–18 000 ft the walk continues every 3 000–4 000 ft, since en-route
 * altitude discrimination matters less. The final stop lands on a light sky
 * blue so the ramp hands off smoothly in hue (though not lightness — see
 * altitudeColor below) into the ≥18 000 ft Class-A lerp, which starts at a
 * dark navy and brightens with altitude.
 *
 * None of these exactly reuse the reserved UI colors documented above this
 * ramp's callers: AIRCRAFT_COLOR/'ground' (#f59e0b), ACTIVE_SEGMENT_COLOR
 * (#ff2bd6), ACTIVE_PROCEDURE_HIGHLIGHT (#facc15), or the traffic/terrain
 * alert chrome ALERT_AMBER (#fbbf24) / WARNING_RED (#ef4444) in
 * src/config/constants.ts — every stop keeps ≥30 RGB-space distance from
 * all five (the 0 ft brick is ~90 from WARNING_RED and much darker).
 */
const HEATMAP: Array<[number, RGB]> = [
  [0,     hexToRgb('#8a340f')],  // brick / burnt red-brown
  [200,   hexToRgb('#9c400f')],
  [400,   hexToRgb('#ae4e10')],  // vermillion-brown
  [600,   hexToRgb('#c05e10')],
  [800,   hexToRgb('#cd7311')],  // orange
  [1000,  hexToRgb('#d68b15')],  // amber-orange
  [1200,  hexToRgb('#dca51a')],  // gold
  [1400,  hexToRgb('#ddc122')],  // yellow
  [1600,  hexToRgb('#d3d629')],  // yellow-chartreuse
  [1800,  hexToRgb('#b8d92c')],  // chartreuse
  [2000,  hexToRgb('#9bda2e')],
  [2200,  hexToRgb('#7dd832')],  // lime
  [2400,  hexToRgb('#61d33a')],
  [2600,  hexToRgb('#4ccb45')],  // lime-green
  [2800,  hexToRgb('#3fc550')],
  [3000,  hexToRgb('#38bf5a')],  // green
  [6000,  hexToRgb('#2bb388')],  // emerald
  [9000,  hexToRgb('#2ba8ac')],  // teal
  [13000, hexToRgb('#30a8d9')],  // cyan
  [18000, hexToRgb('#4fc3f7')],  // sky — hands off to Class A blue lerp
]

/**
 * Returns the display colour for an aircraft at the given barometric altitude.
 *
 * Below 18 000 ft — HEATMAP gradient, brick red-brown at SFC walking
 *   through orange/gold/yellow/lime/green/emerald/teal/cyan to a light sky at
 *   18 000 ft, densely sampled every 200 ft below 3 000 ft.
 * 18 000 ft and above (Class A) — dark sky-blue at the floor, brightening to
 *   a bright sky-blue (#38bdf8) at high altitudes.
 */
export function altitudeColor(alt: number | 'ground'): string {
  if (alt === 'ground') return '#f59e0b'
  const ft = alt as number

  if (ft >= 18000) {
    // Class A: dark sky-blue at the floor → bright sky-blue at high altitude.
    // Sky-400 (#38bdf8) borders on teal without duplicating the cyan SID palette
    // or the indigo STAR palette.
    const t = Math.min(1, (ft - 18000) / (60000 - 18000))
    return rgbToHex(lerp3(hexToRgb('#0c4a6e'), hexToRgb('#38bdf8'), t))
  }

  for (let i = 1; i < HEATMAP.length; i++) {
    const [lo, cLo] = HEATMAP[i - 1]
    const [hi, cHi] = HEATMAP[i]
    if (ft <= hi) {
      return rgbToHex(lerp3(cLo, cHi, (ft - lo) / (hi - lo)))
    }
  }
  return '#dc2626'
}
