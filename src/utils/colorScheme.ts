import type { ProcedureType } from '../types/procedure'

const SID_COLORS = ['#22d3ee', '#06b6d4', '#0891b2', '#0e7490', '#155e75']
// Indigo/blue-violet — deliberately kept away from the magenta active-segment color.
const STAR_COLORS = ['#818cf8', '#6366f1', '#4f46e5', '#4338ca', '#3730a3']
const APPROACH_COLORS = ['#34d399', '#10b981', '#059669', '#047857', '#065f46']

let sidIdx = 0
let starIdx = 0
let approachIdx = 0

export function nextProcedureColor(type: ProcedureType): string {
  switch (type) {
    case 'SID': return SID_COLORS[sidIdx++ % SID_COLORS.length]
    case 'STAR': return STAR_COLORS[starIdx++ % STAR_COLORS.length]
    case 'APPROACH': return APPROACH_COLORS[approachIdx++ % APPROACH_COLORS.length]
  }
}

export function resetColorCounters(): void {
  sidIdx = 0
  starIdx = 0
  approachIdx = 0
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

/** Heatmap stops below Class A: orange at SFC → green near 18 000 ft. */
const HEATMAP: Array<[number, RGB]> = [
  [0,     hexToRgb('#fb923c')],  // orange-400  — bright, high contrast
  [6000,  hexToRgb('#facc15')],  // yellow-400
  [12000, hexToRgb('#a3e635')],  // lime-400
  [18000, hexToRgb('#4ade80')],  // green-400   — no red used here
]

/**
 * Returns the display colour for an aircraft at the given barometric altitude.
 *
 * Below 18 000 ft  — heatmap gradient (blue → cyan → green → yellow → red).
 * 18 000 ft and above (Class A) — goldenrod intensity: dark amber at the floor,
 *   brightening to full goldenrod (#f59e0b) at high altitudes.
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
