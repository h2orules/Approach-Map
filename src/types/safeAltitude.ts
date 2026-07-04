/** One MSA/TAA sector. Bearings are TRUE degrees (magvar applied at parse time). */
export interface SafeAltitudeSector {
  fromBrgTrue: number
  toBrgTrue: number
  innerNm: number // 0 for MSA and for the outermost TAA ring
  outerNm: number
  altitudeFt: number
}

export interface SafeAltitudeArea {
  kind: 'TAA' | 'MSA'
  icao: string
  /** Approach procedure ids this area is charted for; [] = airport-level fallback. */
  procedureIds: string[]
  centerFixId: string
  centerLat: number
  centerLon: number
  sectors: SafeAltitudeSector[]
}
