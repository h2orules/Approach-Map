/**
 * Curated ICAO airline-code → {name, IATA} lookup for decoding callsigns.
 * ADS-B callsigns use the 3-letter ICAO airline code (e.g. "UAL123" → United,
 * flight 123). General-aviation tail numbers (e.g. "N123AB") have no prefix.
 *
 * Covers the carriers common at US airports; unknown codes fall back to the raw
 * callsign. IATA codes drive the (best-effort) logo lookup.
 */
export interface Airline {
  name: string
  iata: string
}

export const AIRLINES: Record<string, Airline> = {
  AAL: { name: 'American Airlines', iata: 'AA' },
  UAL: { name: 'United Airlines', iata: 'UA' },
  DAL: { name: 'Delta Air Lines', iata: 'DL' },
  SWA: { name: 'Southwest Airlines', iata: 'WN' },
  ASA: { name: 'Alaska Airlines', iata: 'AS' },
  JBU: { name: 'JetBlue Airways', iata: 'B6' },
  NKS: { name: 'Spirit Airlines', iata: 'NK' },
  FFT: { name: 'Frontier Airlines', iata: 'F9' },
  HAL: { name: 'Hawaiian Airlines', iata: 'HA' },
  SKW: { name: 'SkyWest Airlines', iata: 'OO' },
  ENY: { name: 'Envoy Air', iata: 'MQ' },
  RPA: { name: 'Republic Airways', iata: 'YX' },
  EDV: { name: 'Endeavor Air', iata: '9E' },
  JIA: { name: 'PSA Airlines', iata: 'OH' },
  AWI: { name: 'Air Wisconsin', iata: 'ZW' },
  ASH: { name: 'Mesa Airlines', iata: 'YV' },
  QXE: { name: 'Horizon Air', iata: 'QX' },
  GJS: { name: 'GoJet Airlines', iata: 'G7' },
  FDX: { name: 'FedEx Express', iata: 'FX' },
  UPS: { name: 'UPS Airlines', iata: '5X' },
  ATN: { name: 'Air Transport Intl', iata: '8C' },
  GTI: { name: 'Atlas Air', iata: '5Y' },
  CKS: { name: 'Kalitta Air', iata: 'K4' },
  AAY: { name: 'Allegiant Air', iata: 'G4' },
  SCX: { name: 'Sun Country Airlines', iata: 'SY' },
  VOI: { name: 'Volaris', iata: 'Y4' },
  // International common at US gateways
  ACA: { name: 'Air Canada', iata: 'AC' },
  WJA: { name: 'WestJet', iata: 'WS' },
  BAW: { name: 'British Airways', iata: 'BA' },
  VIR: { name: 'Virgin Atlantic', iata: 'VS' },
  DLH: { name: 'Lufthansa', iata: 'LH' },
  AFR: { name: 'Air France', iata: 'AF' },
  KLM: { name: 'KLM', iata: 'KL' },
  IBE: { name: 'Iberia', iata: 'IB' },
  SWR: { name: 'Swiss', iata: 'LX' },
  UAE: { name: 'Emirates', iata: 'EK' },
  QTR: { name: 'Qatar Airways', iata: 'QR' },
  ETD: { name: 'Etihad Airways', iata: 'EY' },
  ANA: { name: 'All Nippon Airways', iata: 'NH' },
  JAL: { name: 'Japan Airlines', iata: 'JL' },
  KAL: { name: 'Korean Air', iata: 'KE' },
  AAR: { name: 'Asiana Airlines', iata: 'OZ' },
  CPA: { name: 'Cathay Pacific', iata: 'CX' },
  SIA: { name: 'Singapore Airlines', iata: 'SQ' },
  QFA: { name: 'Qantas', iata: 'QF' },
  AMX: { name: 'Aeroméxico', iata: 'AM' },
  CMP: { name: 'Copa Airlines', iata: 'CM' },
  AVA: { name: 'Avianca', iata: 'AV' },
  LAN: { name: 'LATAM', iata: 'LA' },
  TAM: { name: 'LATAM Brasil', iata: 'JJ' },
}

export interface DecodedCallsign {
  airline: Airline | null
  airlineIcao: string | null
  flightNumber: string | null
  /** True when the callsign looks like a registration / tail number. */
  isTail: boolean
}

/** Decode an ADS-B callsign into airline + flight number, or a tail number. */
export function decodeCallsign(raw: string | null | undefined): DecodedCallsign {
  const cs = (raw ?? '').trim().toUpperCase()
  const empty: DecodedCallsign = { airline: null, airlineIcao: null, flightNumber: null, isTail: false }
  if (!cs) return empty

  // Airline callsign: 3 letters followed by 1-4 alphanumerics
  const m = cs.match(/^([A-Z]{3})(\d[A-Z0-9]*)$/)
  if (m) {
    const icao = m[1]
    return { airline: AIRLINES[icao] ?? null, airlineIcao: icao, flightNumber: m[2], isTail: false }
  }

  // US registration (N-number) or other tail-like ident
  if (/^N\d/.test(cs)) return { ...empty, isTail: true }
  return empty
}

/** Best-effort airline logo URL (avs.io free CDN), keyed by IATA code. */
export function airlineLogoUrl(iata: string): string {
  return `https://pics.avs.io/120/40/${iata}.png`
}
