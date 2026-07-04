import type { Procedure } from './procedure'
import type { SafeAltitudeArea } from './safeAltitude'

export interface CifpRunwayInfo {
  id: string // e.g. RW16C
  lat: number
  lon: number
  thresholdElevFt: number | null
  lengthFt: number | null
}

/** Everything the CIFP parser emits for one airport. */
export interface CifpAirportData {
  procedures: Procedure[]
  safeAltitudes: SafeAltitudeArea[]
  runwayInfo: Record<string, CifpRunwayInfo>
  magVarDeg: number | null // +E / -W, from the PA record
}
