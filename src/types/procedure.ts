import type { FeatureCollection } from 'geojson'

export type ProcedureType = 'SID' | 'STAR' | 'APPROACH'

export type NavaidType = 'VOR' | 'VORTAC' | 'NDB' | 'FIX' | 'RUNWAY' | 'AIRPORT' | null

export interface AltConstraint {
  type: 'AT' | 'AT_OR_ABOVE' | 'AT_OR_BELOW' | 'BETWEEN'
  low: number
  high?: number
}

export interface ProcedureWaypoint {
  id: string
  lat: number
  lon: number
  navaidType: NavaidType
  altConstraint: AltConstraint | null
  sequenceNumber: number
}

export type WaypointRole = 'iaf' | 'faf' | 'map' | 'hold' | 'normal'

/** A renderable waypoint symbol (deduped across a procedure's transitions). */
export interface WaypointSymbol {
  id: string
  lat: number
  lon: number
  navaidType: NavaidType
  role: WaypointRole
  /** Altitude restriction; rendered with FAA over/under bars in the DOM label. */
  alt: AltConstraint | null
  /** Speed restriction in knots (a maximum), or null. */
  speedKt: number | null
  /** FAF of a precision approach (glideslope intercept) — drawn with a bolt. */
  gsFaf: boolean
  /** True when ARINC 424 waypoint description code position 2 is 'Y' (flyover). */
  flyover: boolean
}

export interface Procedure {
  id: string
  icao: string
  name: string
  type: ProcedureType
  runways: string[]
  waypoints: ProcedureWaypoint[]
  symbols: WaypointSymbol[]
  geojson: FeatureCollection
  hasGeometry: boolean
  color: string
}

export type ProcedureVisibilitySource = 'user' | 'auto' | 'none'
