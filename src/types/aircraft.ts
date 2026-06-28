export interface AdsbAircraft {
  hex: string
  type?: string
  flight?: string
  r?: string
  t?: string
  alt_baro?: number | 'ground'
  alt_geom?: number
  gs?: number
  track?: number
  baro_rate?: number
  squawk?: string
  lat?: number
  lon?: number
  seen?: number
  seen_pos?: number
  mlat?: string[]
  tisb?: string[]
}

export interface AdsbResponse {
  ac: AdsbAircraft[]
  total: number
  ctime: number
  ptime: number
}

export interface InterpolatedAircraft {
  hex: string
  flight: string
  registration: string
  typeCode: string
  lat: number
  lon: number
  altBaro: number | 'ground'
  altGeom: number | null
  groundspeed: number
  track: number
  baroRate: number
  squawk: string
  lastPollMs: number
  interpLat: number
  interpLon: number
  origin?: string
  destination?: string
}
