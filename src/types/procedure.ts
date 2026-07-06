import type { FeatureCollection } from 'geojson'

export type ProcedureType = 'SID' | 'STAR' | 'APPROACH'

export type NavaidType = 'VOR' | 'VORTAC' | 'NDB' | 'FIX' | 'RUNWAY' | 'AIRPORT' | 'LOC' | null

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
  /**
   * DME distance (nm) from the recommended navaid to this fix (ARINC 424 Rho,
   * cols 67-70, tenths of nm).  Null when not specified or zero.
   * Optional for backwards compatibility with pre-parsed IndexedDB cache entries.
   */
  dmeNm?: number | null
  /**
   * Identifier of the recommended navaid the DME distance is measured from
   * (ARINC 424 Recommended NAVAID, cols 51-54). Null when this fix has no DME.
   * The navaid itself is emitted as its own symbol (isDmeSource) so it renders.
   */
  dmeNavaid?: string | null
  /**
   * True when this symbol is a navaid emitted solely because it is the DME
   * reference for another fix on the procedure. Rendered with a DME ring.
   */
  isDmeSource?: boolean
  /**
   * Marker-beacon type when this fix is a marker: 'OM'/'MM'/'IM'. The FAA CIFP
   * has no marker records, so in practice only 'OM' is produced — detected when
   * an approach FAF is collocated with an NDB (a Locator Outer Marker). Null/
   * absent when not a marker.
   */
  marker?: 'OM' | 'MM' | 'IM' | null
  /**
   * True when the marker is a locator (collocated NDB) — an LOM. Drives the
   * FAA NDB overlay (radiating concentric dots) drawn over the marker lens.
   */
  markerLocator?: boolean
}

/** One parsed leg of a transition, preserving path/terminator detail for profile rendering. */
export interface ProcedureLeg {
  seq: number
  fixId: string
  lat: number
  lon: number
  navaidType: NavaidType
  altConstraint: AltConstraint | null
  pathTerm: string // CF/TF/RF/AF/HM/HF/HA/PI/...
  role: WaypointRole
  flyover: boolean
  turnRight: boolean
  course: number // degrees (magCourse / 10)
  legNm: number // straight-leg length, nm
  speedKt: number // 0 = none
  dmeNm: number | null
  recNavId: string // '' if absent
}

export interface ProcedureTransition {
  id: string // transitionId, '(common)' for blank
  legs: ProcedureLeg[] // ordered by seq
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
  transitions?: ProcedureTransition[]
  /** Published glide path angle; null/absent = unknown (renderers fall back to 3°). */
  gpaDeg?: number | null
  /** Threshold crossing height, ft. */
  tchFt?: number | null
}

export type ProcedureVisibilitySource = 'user' | 'auto' | 'none'
