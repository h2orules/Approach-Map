import { describe, it, expect } from 'vitest'
import {
  buildLookup,
  resolveOaRow,
  isIcaoKey,
  countProcedures,
  regionState,
  deriveMetadata,
  enumerateAirports,
} from '../airportIndex'
import type { OaRow } from '../runways'
import type { CifpAirportData } from '../../../src/types/cifp'
import type { Procedure } from '../../../src/types/procedure'

function oaRow(overrides: Partial<OaRow> = {}): OaRow {
  return {
    ident: '',
    gps_code: '',
    local_code: '',
    name: '',
    municipality: '',
    iso_region: '',
    latitude_deg: '0',
    longitude_deg: '0',
    elevation_ft: '0',
    ...overrides,
  }
}

function approach(name: string): Procedure {
  return {
    id: name,
    icao: 'KSEA',
    name,
    type: 'APPROACH',
    runways: ['16C'],
    waypoints: [],
    symbols: [],
    geojson: { type: 'FeatureCollection', features: [] },
    hasGeometry: true,
    color: '#34d399',
  }
}

function sid(name: string): Procedure {
  return { ...approach(name), type: 'SID' }
}

function star(name: string): Procedure {
  return { ...approach(name), type: 'STAR' }
}

function cifpData(procedures: Procedure[], runwayInfo: CifpAirportData['runwayInfo'] = {}): CifpAirportData {
  return { procedures, safeAltitudes: [], runwayInfo, magVarDeg: null }
}

describe('buildLookup / resolveOaRow', () => {
  it('resolves a K-prefixed ICAO via ident', () => {
    const row = oaRow({ ident: 'KSEA' })
    const lookup = buildLookup([row])
    expect(resolveOaRow(lookup, 'KSEA')).toBe(row)
  })

  it('resolves a 3-char FAA LID (A09-style) via local_code, no K prefix involved', () => {
    const row = oaRow({ ident: 'A09', local_code: 'A09' })
    const lookup = buildLookup([row])
    expect(resolveOaRow(lookup, 'A09')).toBe(row)
  })

  it('resolves a 3-char LID key from an OA row registered only under local_code', () => {
    const row = oaRow({ ident: 'SOME-OTHER-ID', local_code: 'A09' })
    const lookup = buildLookup([row])
    expect(resolveOaRow(lookup, 'A09')).toBe(row)
  })

  it('does not mangle PA/PH-prefixed ICAO-like idents (no stray K-stripping)', () => {
    const pa = oaRow({ ident: 'PANC' })
    const ph = oaRow({ ident: 'PHNL' })
    const lookup = buildLookup([pa, ph])
    expect(resolveOaRow(lookup, 'PANC')).toBe(pa)
    expect(resolveOaRow(lookup, 'PHNL')).toBe(ph)
    // Neither is 4-char-K-prefixed, so no K-stripping fallback applies, and
    // neither is 3-char, so no K-prepend fallback applies either.
    expect(resolveOaRow(lookup, 'ANC')).toBeUndefined()
  })

  it('falls back from a 4-char K-prefixed key to the 3-char OA row', () => {
    const row = oaRow({ ident: 'AWO' })
    const lookup = buildLookup([row])
    expect(resolveOaRow(lookup, 'KAWO')).toBe(row)
  })

  it('falls back from a 3-char key to the K-prefixed OA row', () => {
    const row = oaRow({ ident: 'KAWO' })
    const lookup = buildLookup([row])
    expect(resolveOaRow(lookup, 'AWO')).toBe(row)
  })

  it('returns undefined for a key with no match anywhere', () => {
    const lookup = buildLookup([oaRow({ ident: 'KSEA' })])
    expect(resolveOaRow(lookup, 'KJFK')).toBeUndefined()
  })

  it('first registration wins on collision across ident/gps_code/local_code', () => {
    const first = oaRow({ ident: 'KSEA', name: 'first' })
    const second = oaRow({ gps_code: 'KSEA', name: 'second' })
    const lookup = buildLookup([first, second])
    expect(resolveOaRow(lookup, 'KSEA')).toBe(first)
  })

  it('is case-insensitive and trims whitespace on both registration and lookup', () => {
    const row = oaRow({ ident: ' ksea ' })
    const lookup = buildLookup([row])
    expect(resolveOaRow(lookup, ' KSea ')).toBe(row)
  })
})

describe('isIcaoKey', () => {
  it('accepts 4-letter identifiers', () => {
    expect(isIcaoKey('KSEA')).toBe(true)
    expect(isIcaoKey('PANC')).toBe(true)
  })

  it('rejects LIDs with digits or wrong length', () => {
    expect(isIcaoKey('A09')).toBe(false)
    expect(isIcaoKey('AWO')).toBe(false)
    expect(isIcaoKey('KSEAX')).toBe(false)
  })
})

describe('countProcedures', () => {
  it('counts SIDs, STARs, and approaches independently', () => {
    const counts = countProcedures([sid('S1'), sid('S2'), star('T1'), approach('A1'), approach('A2'), approach('A3')])
    expect(counts).toEqual({ s: 2, t: 1, a: 3 })
  })

  it('returns all zeros for an empty procedure list', () => {
    expect(countProcedures([])).toEqual({ s: 0, t: 0, a: 0 })
  })
})

describe('regionState', () => {
  it('extracts the state/region suffix from an iso_region code', () => {
    expect(regionState('US-WA')).toBe('WA')
  })

  it('returns the whole string when there is no dash', () => {
    expect(regionState('WA')).toBe('WA')
  })

  it('returns empty string for undefined/empty input', () => {
    expect(regionState(undefined)).toBe('')
    expect(regionState('')).toBe('')
  })
})

describe('deriveMetadata', () => {
  it('prefers the OurAirports row when present and its coords parse', () => {
    const data = cifpData([approach('I16C')])
    const row = oaRow({
      name: 'Seattle-Tacoma Intl',
      municipality: 'Seattle',
      iso_region: 'US-WA',
      latitude_deg: '47.4489',
      longitude_deg: '-122.3094',
      elevation_ft: '433',
    })
    const meta = deriveMetadata('KSEA', data, row)
    expect(meta).toEqual({
      name: 'Seattle-Tacoma Intl',
      city: 'Seattle',
      state: 'WA',
      lat: 47.4489,
      lon: -122.3094,
      elev: 433,
      matched: true,
    })
  })

  it('falls back to the runway-threshold centroid when there is no OA row', () => {
    const data = cifpData([approach('I34')], {
      RW34: { id: 'RW34', lat: 48.0, lon: -122.0, thresholdElevFt: 100, lengthFt: 5000 },
      RW16: { id: 'RW16', lat: 48.02, lon: -122.02, thresholdElevFt: 120, lengthFt: 5000 },
    })
    const meta = deriveMetadata('KAWO', data, undefined)
    expect(meta).not.toBeNull()
    expect(meta!.matched).toBe(false)
    expect(meta!.lat).toBeCloseTo(48.01, 5)
    expect(meta!.lon).toBeCloseTo(-122.01, 5)
    expect(meta!.elev).toBe(110)
    expect(meta!.name).toBe('KAWO')
    expect(meta!.city).toBe('')
    expect(meta!.state).toBe('')
  })

  it('returns null when neither an OA row nor runway thresholds can place the airport', () => {
    const data = cifpData([approach('I34')], {})
    expect(deriveMetadata('KAWO', data, undefined)).toBeNull()
  })

  it('falls back to the CIFP centroid when the OA row has unparseable coords', () => {
    const data = cifpData([approach('I34')], {
      RW34: { id: 'RW34', lat: 48.0, lon: -122.0, thresholdElevFt: null, lengthFt: null },
    })
    const row = oaRow({ latitude_deg: 'not-a-number', longitude_deg: 'nope' })
    const meta = deriveMetadata('KAWO', data, row)
    expect(meta).not.toBeNull()
    expect(meta!.matched).toBe(false)
    expect(meta!.lat).toBe(48.0)
  })

  it('defaults elevation to 0 when the OA row elevation is unparseable', () => {
    const data = cifpData([approach('I16C')])
    const row = oaRow({ latitude_deg: '47.4', longitude_deg: '-122.3', elevation_ft: 'unknown' })
    const meta = deriveMetadata('KSEA', data, row)
    expect(meta!.elev).toBe(0)
  })
})

describe('enumerateAirports', () => {
  it('golden case: KSEA/KJFK/PANC resolve via ident and get icao set', () => {
    const cifp: Record<string, CifpAirportData> = {
      KSEA: cifpData([approach('I16C'), sid('HAROB1')]),
      KJFK: cifpData([approach('I31L')]),
      PANC: cifpData([approach('I07R'), star('KIMCHI1')]),
    }
    const lookup = buildLookup([
      oaRow({ ident: 'KSEA', name: 'Sea-Tac', municipality: 'Seattle', iso_region: 'US-WA', latitude_deg: '47.4', longitude_deg: '-122.3', elevation_ft: '433' }),
      oaRow({ ident: 'KJFK', name: 'JFK', municipality: 'New York', iso_region: 'US-NY', latitude_deg: '40.6', longitude_deg: '-73.8', elevation_ft: '13' }),
      oaRow({ ident: 'PANC', name: 'Anchorage', municipality: 'Anchorage', iso_region: 'US-AK', latitude_deg: '61.2', longitude_deg: '-149.9', elevation_ft: '152' }),
    ])

    const rows = enumerateAirports(cifp, lookup)
    expect(rows).toHaveLength(3)

    const bySea = rows.find((r) => r.key === 'KSEA')!
    expect(bySea.icao).toBe('KSEA')
    expect(bySea.name).toBe('Sea-Tac')
    expect(bySea.state).toBe('WA')
    expect(bySea).toMatchObject({ s: 1, t: 0, a: 1 })

    const byJfk = rows.find((r) => r.key === 'KJFK')!
    expect(byJfk.icao).toBe('KJFK')

    const byAnc = rows.find((r) => r.key === 'PANC')!
    expect(byAnc.icao).toBe('PANC')
    expect(byAnc).toMatchObject({ s: 0, t: 1, a: 1 })
  })

  it('golden case: a LID-only field (A09-style) resolves via local_code with no icao set', () => {
    const cifp: Record<string, CifpAirportData> = {
      A09: cifpData([approach('R34')], {
        RW34: { id: 'RW34', lat: 48.0, lon: -122.0, thresholdElevFt: 100, lengthFt: 3000 },
      }),
    }
    const lookup = buildLookup([oaRow({ ident: 'A09', local_code: 'A09', name: 'Podunk Field' })])

    const rows = enumerateAirports(cifp, lookup)
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('A09')
    expect(rows[0].icao).toBeUndefined()
    expect(rows[0].name).toBe('Podunk Field')
  })

  it('excludes airports with zero approaches even if they have SIDs/STARs', () => {
    const cifp: Record<string, CifpAirportData> = {
      KBFI: cifpData([sid('BOEING1'), star('CHINS1')]),
    }
    const lookup = buildLookup([oaRow({ ident: 'KBFI', name: 'Boeing Field' })])
    expect(enumerateAirports(cifp, lookup)).toEqual([])
  })

  it('excludes an airport that cannot be placed by either OA or CIFP centroid', () => {
    const cifp: Record<string, CifpAirportData> = {
      KXXX: cifpData([approach('I01')], {}),
    }
    const lookup = buildLookup([]) // no OA row at all
    expect(enumerateAirports(cifp, lookup)).toEqual([])
  })

  it('dedupes when multiple OurAirports rows collide on the same identifier key', () => {
    const cifp: Record<string, CifpAirportData> = { KSEA: cifpData([approach('I16C')]) }
    const lookup = buildLookup([
      oaRow({ ident: 'KSEA', name: 'first-registered' }),
      oaRow({ gps_code: 'KSEA', name: 'second-registered' }),
    ])
    const rows = enumerateAirports(cifp, lookup)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('first-registered')
  })

  it('produces rows in CIFP-key insertion order (deterministic output)', () => {
    const cifp: Record<string, CifpAirportData> = {
      KJFK: cifpData([approach('I31L')]),
      KAWO: cifpData([approach('L34')], { RW34: { id: 'RW34', lat: 48, lon: -122, thresholdElevFt: 0, lengthFt: 3000 } }),
      KSEA: cifpData([approach('I16C')]),
    }
    const lookup = buildLookup([oaRow({ ident: 'KJFK' }), oaRow({ ident: 'KSEA' })])
    const rows = enumerateAirports(cifp, lookup)
    expect(rows.map((r) => r.key)).toEqual(['KJFK', 'KAWO', 'KSEA'])
  })
})
