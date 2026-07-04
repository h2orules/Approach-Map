import { describe, it, expect } from 'vitest'
import {
  parseAirportMagVar,
  parseRunwayExtras,
  parseIlsGsFields,
  parsePathPointRecord,
  parseMsaRecord,
  parseTaaRecord,
  magneticToTrue,
  buildSafeAltitudeAreas,
  type MsaRawRecord,
} from '../arincRecords'

// All fixtures below are verbatim 132-char records from live FAA CIFP data
// (FAACIFP18, AIRAC cycle 2026-03-19), except the TAA record — FAA CIFP ships
// no TAA (PK) records, so that fixture is built to the ARINC 424-18 PK column
// layout (radius 4 / bearing 6 / altitude 3, sectors from col 42).

const PA_KSEA =
  'SUSAP KSEAK1ASEA     0     119YHN47265960W122184240E016000432         1800018000C    MNAR    SEATTLE-TACOMA INTL           125721807'
const PG_KSEA_16C =
  'SUSAP KSEAK1GRW16C   0094261640 N47274972W122183954         +0107900429000055150IISZI3                                     134121810'
const PI_KSEA_ISNQ =
  'SUSAP KSEAK1IISNQ3   011030RW16LN47254222W1221829031643N47273894W1221833821013 10890311300E01605600425                     134211903'
const PI_PADL_LOC =
  'SCANP PADLPAIIDLG0   011190RW19 N59020727W1583052301955                   0607     0570   E0110                            068762409'
const PP_KSEA_R16C =
  'SUSAP KSEAK1PR16CY RW16C001Y0000W16B0N4727497125W12218395460+010800300N4726166910W12218403600106750000000566F40035046D3A1E1134241303'
const MSA_KDEN_DEN =
  'SUSAP KDENK2SDEN  K2D                 0   18018009225                                                                  M   691891110'
const MSA_PACD_CDB =
  'SCANP PACDPASCDB  PAD                 0   090180030251802700622527009007125                                            M   062351210'
// Synthetic PK record (spec column layout): KABC approach R06, waypoint ABCDE,
// magnetic, two sectors: 30.0nm/270°->090°/4000ft and 30.0nm/090°->270°/5500ft.
const TAA_KABC =
  'SUSAP KABCK2KR06   ABCDEK2PCA0          M03002700900400300090270055                                                        123452403'

describe('parseAirportMagVar (PA record, cols 52-56)', () => {
  it('parses east variation as positive (KSEA E0160 => +16.0)', () => {
    expect(parseAirportMagVar(PA_KSEA)).toBeCloseTo(16.0, 5)
  })
  it('parses west variation as negative', () => {
    const w = PA_KSEA.slice(0, 51) + 'W0110' + PA_KSEA.slice(56)
    expect(parseAirportMagVar(w)).toBeCloseTo(-11.0, 5)
  })
})

describe('parseRunwayExtras (PG record)', () => {
  it('reads runway length (cols 23-27) and threshold elevation (cols 67-71)', () => {
    const r = parseRunwayExtras(PG_KSEA_16C)!
    expect(r).not.toBeNull()
    expect(r.icao).toBe('KSEA')
    expect(r.runwayId).toBe('RW16C')
    expect(r.lengthFt).toBe(9426)
    expect(r.thresholdElevFt).toBe(429)
  })
  it('returns null for non-runway records', () => {
    expect(parseRunwayExtras(PA_KSEA)).toBeNull()
  })
})

describe('parseIlsGsFields (PI record)', () => {
  it('reads glide-slope angle (cols 88-90, hundredths) and TCH (cols 96-97)', () => {
    const r = parseIlsGsFields(PI_KSEA_ISNQ)!
    expect(r.icao).toBe('KSEA')
    expect(r.locId).toBe('ISNQ')
    expect(r.runwayId).toBe('16L')
    expect(r.gsAngleDeg).toBeCloseTo(3.0, 5)
    expect(r.gsTchFt).toBe(56)
  })
  it('returns null glide-slope fields for a LOC-only record', () => {
    const r = parseIlsGsFields(PI_PADL_LOC)!
    expect(r.locId).toBe('IDLG')
    expect(r.gsAngleDeg).toBeNull()
    expect(r.gsTchFt).toBeNull()
  })
})

describe('parsePathPointRecord (PP record)', () => {
  it('reads glide-path angle (cols 67-70, hundredths) and TCH (cols 103-108, tenths)', () => {
    const r = parsePathPointRecord(PP_KSEA_R16C)!
    expect(r.icao).toBe('KSEA')
    expect(r.approachId).toBe('R16CY')
    expect(r.runwayId).toBe('RW16C')
    expect(r.gpaDeg).toBeCloseTo(3.0, 5)
    expect(r.tchFt).toBeCloseTo(56.6, 3)
  })
})

describe('parseMsaRecord (PS record)', () => {
  it('parses a single full-circle sector (KDEN DEN)', () => {
    const r = parseMsaRecord(MSA_KDEN_DEN)!
    expect(r.icao).toBe('KDEN')
    expect(r.centerFixId).toBe('DEN')
    expect(r.magnetic).toBe(true)
    expect(r.sectors).toHaveLength(1)
    expect(r.sectors[0]).toEqual({ fromBrg: 180, toBrg: 180, altitudeFt: 9200, radiusNm: 25 })
  })
  it('parses multiple sectors (PACD CDB, 3 sectors)', () => {
    const r = parseMsaRecord(MSA_PACD_CDB)!
    expect(r.centerFixId).toBe('CDB')
    expect(r.sectors).toHaveLength(3)
    expect(r.sectors.map((s) => s.altitudeFt)).toEqual([3000, 6200, 7100])
    expect(r.sectors.map((s) => [s.fromBrg, s.toBrg])).toEqual([
      [90, 180],
      [180, 270],
      [270, 90],
    ])
    expect(r.sectors.every((s) => s.radiusNm === 25)).toBe(true)
  })
})

describe('parseTaaRecord (PK record, spec layout)', () => {
  it('parses radius (tenths nm), bearings and altitude (hundreds ft)', () => {
    const r = parseTaaRecord(TAA_KABC)!
    expect(r.icao).toBe('KABC')
    expect(r.approachId).toBe('R06')
    expect(r.waypointId).toBe('ABCDE')
    expect(r.magnetic).toBe(true)
    expect(r.sectors).toHaveLength(2)
    expect(r.sectors[0]).toEqual({ fromBrg: 270, toBrg: 90, altitudeFt: 4000, radiusNm: 30 })
    expect(r.sectors[1]).toEqual({ fromBrg: 90, toBrg: 270, altitudeFt: 5500, radiusNm: 30 })
  })
})

describe('magneticToTrue', () => {
  it('adds east variation and wraps past 360 (350°M + 12°E = 2°T)', () => {
    expect(magneticToTrue(350, 12)).toBeCloseTo(2, 5)
  })
  it('subtracts west variation and wraps below 0 (5°M + -10°W = 355°T)', () => {
    expect(magneticToTrue(5, -10)).toBeCloseTo(355, 5)
  })
  it('leaves the bearing unchanged when variation is null', () => {
    expect(magneticToTrue(123, null)).toBe(123)
  })
})

describe('buildSafeAltitudeAreas', () => {
  const resolve = (id: string) =>
    id === 'DEN' ? { lat: 39.8, lon: -104.7 } : id === 'ABC' ? { lat: 40, lon: -105 } : null

  it('converts magnetic MSA sectors to true and applies center coords', () => {
    const msa = parseMsaRecord(MSA_KDEN_DEN)!
    const areas = buildSafeAltitudeAreas([msa], [], resolve, 8.0, () => ['KDEN-APPROACH-I35R'])
    expect(areas).toHaveLength(1)
    const a = areas[0]
    expect(a.kind).toBe('MSA')
    expect(a.icao).toBe('KDEN')
    expect(a.centerLat).toBe(39.8)
    expect(a.procedureIds).toEqual(['KDEN-APPROACH-I35R'])
    expect(a.sectors[0].fromBrgTrue).toBeCloseTo(188, 5) // 180°M + 8°E
    expect(a.sectors[0].innerNm).toBe(0)
    expect(a.sectors[0].outerNm).toBe(25)
    expect(a.sectors[0].altitudeFt).toBe(9200)
  })

  it('defaults a blank sector radius to 25nm and defaults procedureIds to []', () => {
    const raw: MsaRawRecord = {
      icao: 'KABC',
      centerFixId: 'ABC',
      magnetic: false,
      sectors: [{ fromBrg: 0, toBrg: 360, altitudeFt: 5000, radiusNm: null }],
    }
    const areas = buildSafeAltitudeAreas([raw], [], resolve, null)
    expect(areas).toHaveLength(1)
    expect(areas[0].procedureIds).toEqual([])
    expect(areas[0].sectors[0].outerNm).toBe(25)
    expect(areas[0].sectors[0].fromBrgTrue).toBe(0) // not magnetic: unchanged
  })

  it('skips MSA/TAA whose center fix cannot be resolved', () => {
    const msa = parseMsaRecord(MSA_PACD_CDB)! // center CDB not in resolver
    expect(buildSafeAltitudeAreas([msa], [], resolve, null)).toHaveLength(0)
  })

  it('builds a TAA area with procedureIds from the approach ident', () => {
    const taa = parseTaaRecord(TAA_KABC)!
    const areas = buildSafeAltitudeAreas([], [taa], () => ({ lat: 40, lon: -105 }), null)
    expect(areas).toHaveLength(1)
    expect(areas[0].kind).toBe('TAA')
    expect(areas[0].procedureIds).toEqual(['R06'])
    expect(areas[0].sectors[0].outerNm).toBe(30)
  })
})
