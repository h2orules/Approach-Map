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

export type WaypointRole = 'iaf' | 'if' | 'faf' | 'map' | 'hold' | 'normal'

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
  course: number // degrees (magCourse / 10) — MAGNETIC, matches the published chart
  legNm: number // straight-leg length, nm
  speedKt: number // 0 = none
  dmeNm: number | null
  recNavId: string // '' if absent
  /**
   * Leg vertical descent angle (VDA) in degrees, from ARINC 424 cols 103-106
   * (signed hundredths of a degree, e.g. "-305" => 3.05). Present mainly on the
   * final-approach leg of non-precision approaches. Sign is normalized away
   * (always the descent magnitude); null/absent when the field is blank/zero.
   */
  vertAngleDeg?: number | null
  /**
   * Procedure-turn (PI leg) geometry, derived from the raw ARINC 424 fields.
   * The coded magCourse of a PI leg is the 45° BARB course, and legLen is the
   * "remain within" excursion limit — NOT the outbound course/length. All
   * courses here are MAGNETIC (convert with the airport magvar before drawing).
   * Present only on PI legs.
   */
  pi?: {
    outboundCourseMag: number
    inboundCourseMag: number
    barbCourseMag: number
    limitNm: number
  }
}

export interface ProcedureTransition {
  id: string // transitionId, '(common)' for blank
  legs: ProcedureLeg[] // ordered by seq
  /**
   * True when this transition is a NoPT (No Procedure Turn) route on an approach
   * that publishes a course reversal on another transition. Inferred: an approach
   * has a course reversal (PI or HF leg) in some transition, and this named
   * enroute transition contains none, so it joins the final segment straight-in.
   */
  noPt?: boolean
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
  /**
   * Where `gpaDeg` came from: an RNAV path point, an ILS glide slope, a
   * non-precision leg vertical descent angle (VDA), or nothing (renderer falls
   * back to 3°). Absent on legacy cached data.
   */
  gsSource?: 'pathPoint' | 'ilsGs' | 'vda' | 'default'
  /** Airport magnetic variation, east positive (from the PA airport record). */
  magVarDeg?: number
  /**
   * Course-reversal (procedure turn) metadata for an approach that publishes a
   * PI leg. `alt` is the PI leg's own crossing constraint; `entryAlt` is the
   * constraint on the IF leg at the same fix in the same transition (the
   * arrival altitude before entering the turn). Absent when no PI leg exists.
   */
  courseReversal?: {
    fixId: string
    transitionId: string
    outboundCourseMag: number
    inboundCourseMag: number
    turnRight: boolean
    limitNm: number
    alt: AltConstraint | null
    entryAlt: AltConstraint | null
  }
  /**
   * Hold-in-lieu-of-procedure-turn (HILPT) metadata for an approach that
   * publishes an HF leg (e.g. KAWO RNAV 34 at SAVOY). Courses are MAGNETIC
   * (chart display values); `alt` is the HF leg's own crossing constraint.
   * Absent when no HF leg exists.
   */
  holdInLieu?: {
    fixId: string
    transitionId: string
    inboundCourseMag: number
    outboundCourseMag: number
    turnRight: boolean
    legNm: number
    alt: AltConstraint | null
  }
}

export type ProcedureVisibilitySource = 'user' | 'auto' | 'none'
