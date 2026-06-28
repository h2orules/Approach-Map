import type { ProcedureType } from '../types/procedure'

const SID_COLORS = ['#22d3ee', '#06b6d4', '#0891b2', '#0e7490', '#155e75']
const STAR_COLORS = ['#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6']
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
export const EXTENDED_CENTERLINE_COLOR = '#6b7280'
export const RUNWAY_FILL_COLOR = '#374151'
