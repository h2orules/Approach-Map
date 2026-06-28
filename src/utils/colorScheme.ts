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
export const RUNWAY_FILL_COLOR = '#374151'
