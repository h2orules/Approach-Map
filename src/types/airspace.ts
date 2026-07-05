import type { Polygon, MultiPolygon } from 'geojson'

/** The four charted airspace classes this overlay draws (from the FAA `CLASS` field). */
export type AirspaceClass = 'B' | 'C' | 'D' | 'E'

/**
 * Rendering style bucket, derived from CLASS + LOCAL_TYPE. Each bucket maps to
 * an FAA-sectional line treatment (see src/utils/airspaceFormat.ts):
 *
 *   B        blue, solid
 *   C        magenta, solid
 *   D        blue, dashed
 *   E_SFC    magenta, dashed        (Class E surface area — CLASS_E2)
 *   E_TRANS  magenta, soft vignette (700ft/1200ft AGL floors — E3/E4/E5/E6)
 */
export type AirspaceStyle = 'B' | 'C' | 'D' | 'E_SFC' | 'E_TRANS'

/** One charted airspace polygon with the fields needed to draw + label it. */
export interface AirspaceSector {
  /** Full published name, e.g. "SEATTLE CLASS B". */
  name: string
  airspaceClass: AirspaceClass
  /** FAA LOCAL_TYPE, e.g. "CLASS_B", "CLASS_E5". */
  localType: string
  style: AirspaceStyle
  /** Floor value in feet (see lowerCode for the datum). */
  lowerVal: number
  /** 'SFC' | 'MSL' | 'AGL' | 'FL' | '' — the floor datum. */
  lowerCode: string
  /** Ceiling value in feet; the FAA sentinel -9998 means "no charted ceiling" (Class E). */
  upperVal: number
  /** 'MSL' | 'AGL' | 'FL' | '' — the ceiling datum. */
  upperCode: string
  geometry: Polygon | MultiPolygon
}
