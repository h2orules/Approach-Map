import type { AirspaceClass, AirspaceStyle, AirspaceSector } from '../types/airspace'

// FAA sentinel used in the Class_Airspace dataset for "no charted ceiling"
// (Class E extends up to the overlying controlled airspace).
export const NO_CEILING = -9998

/**
 * Maps CLASS + floor to the sectional line treatment. Class E splits by floor:
 * a surface-based area (floor at/below the surface — CLASS_E2/E4) draws as a
 * dashed magenta boundary, while a raised transition floor (700ft/1200ft AGL —
 * CLASS_E5/E6/E3) reads as a soft magenta vignette.
 */
export function airspaceStyleFor(cls: AirspaceClass, lowerVal: number): AirspaceStyle {
  switch (cls) {
    case 'B':
      return 'B'
    case 'C':
      return 'C'
    case 'D':
      return 'D'
    case 'E':
      return lowerVal <= 0 ? 'E_SFC' : 'E_TRANS'
  }
}

/**
 * Formats one altitude the sectional way: hundreds of feet, with the surface
 * spelled out. e.g. 10000 → "100", 2500 → "25", 1800 → "18", 0/SFC → "SFC".
 * Flight levels (code 'FL') pass through as "FLxxx".
 */
export function altHundreds(valFt: number, code: string): string {
  if (code === 'SFC' || valFt <= 0) return 'SFC'
  if (code === 'FL') return `FL${valFt}`
  return String(Math.round(valFt / 100))
}

export interface AirspaceAltLabel {
  /** Ceiling text (top of the fraction, or the single boxed value for Class D). */
  ceiling: string
  /** Floor text (bottom of the fraction); null for Class D (ceiling only). */
  floor: string | null
}

/**
 * The boxed altitude label for a sector, following sectional convention:
 *   - Class B / C: a ceiling-over-floor fraction (e.g. 100 / 50).
 *   - Class D: the ceiling only, shown in a bracketed box (e.g. [25]).
 *   - Class E: no numeric label — the shading/line style conveys the floor.
 * Returns null when there is nothing meaningful to draw.
 */
export function airspaceAltLabel(sector: AirspaceSector): AirspaceAltLabel | null {
  const { airspaceClass, lowerVal, lowerCode, upperVal, upperCode } = sector
  if (airspaceClass === 'E') return null
  if (upperVal === NO_CEILING || upperVal <= 0) return null

  const ceiling = altHundreds(upperVal, upperCode)
  if (airspaceClass === 'D') return { ceiling, floor: null }
  return { ceiling, floor: altHundreds(lowerVal, lowerCode) }
}
