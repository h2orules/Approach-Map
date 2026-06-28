export interface Airport {
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
