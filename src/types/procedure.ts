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

export interface Procedure {
  id: string
  icao: string
  name: string
  type: ProcedureType
  runways: string[]
  waypoints: ProcedureWaypoint[]
  geojson: FeatureCollection
  hasGeometry: boolean
  color: string
}

export type ProcedureVisibilitySource = 'user' | 'auto' | 'none'
