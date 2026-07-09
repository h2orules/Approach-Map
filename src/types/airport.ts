export interface Airport {
  /**
   * Search/data key — the identifier the per-airport data shard and index row
   * are keyed by. Equals `icao` for ICAO airports; for non-ICAO US fields it is
   * the FAA location identifier (LID, e.g. "A09"). Optional for backwards
   * compatibility with the curated airports.json (which omits it today).
   */
  key?: string
  /**
   * ICAO code, read pervasively downstream (search, procedure/runway/ATIS
   * lookups). For LID-only airports (no true ICAO code) this is set to `key`
   * for display purposes — since CIFP data is keyed by the same identifier,
   * that also makes it functionally correct as a lookup key, not just cosmetic.
   */
  icao: string
  iata: string
  name: string
  lat: number
  lon: number
  elevation: number
  city: string
  state: string
}

export interface RunwayEnd {
  id: string
  heading: number
  lat: number
  lon: number
  displacedThresholdFt: number
}

export interface Runway {
  id: string
  lengthFt: number
  widthFt: number
  surfaceCode: string
  lowEnd: RunwayEnd
  highEnd: RunwayEnd
}
