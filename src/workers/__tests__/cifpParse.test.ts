import { describe, it, expect, vi } from 'vitest'
import { parseCifp } from '../cifpParse'

// Regression test for the cifpParser.worker.ts -> cifpParse.ts extraction seam
// (see CLAUDE.md: "Pure, node-runnable CIFP parse"). Builds a full synthetic
// FAACIFP18 text from the same KAWO LOC RWY 34 ("FL34") fixture lines used in
// ../__tests__/cifpParseCore.test.ts (real FAA data, verbatim) plus minimal
// synthetic P/C (terminal waypoint) and P/G (runway threshold) records for the
// fixes those lines reference (AW, PAE, SAVOY, WATON, RW34) — parseCifp's pass
// 1 resolves leg positions by name from exactly these record types, and they
// aren't present in the leg-only cifpParseCore fixtures. Coordinates in the
// synthetic records are arbitrary (not real KAWO positions); only the fixed
// column offsets that parseCifp.ts itself reads (see comments below) need to
// be correct. This exercises the full two-pass parse/group/derive pipeline
// end-to-end — something cifpParseCore.test.ts, which only unit-tests the
// per-line helpers, cannot catch (e.g. a grouping or lookup-wiring bug).

/** Build a fixed-width ARINC-424-shaped line by poking text at 0-based column
 *  offsets into an otherwise-blank line, mirroring the exact slice() bounds
 *  cifpParse.ts and cifpParseCore.ts read from. */
function mkLine(overrides: Record<number, string>, length = 135): string {
  const chars = new Array(length).fill(' ')
  for (const [startStr, text] of Object.entries(overrides)) {
    const start = Number(startStr)
    for (let i = 0; i < text.length; i++) chars[start + i] = text[i]
  }
  return chars.join('')
}

// Real KAWO PA (airport reference) record — verbatim from cifpParseCore.test.ts.
// Provides magVarDeg (+17.0E) and the airport reference position.
const PA_KAWO =
  'SUSAP KAWOK1AAWO     0     053YHN48093870W122093250E017000142         1800018000C    MNAR    ARLINGTON MUNI                281361109'

// Synthetic terminal-waypoint (P/C, subsection at col 13 i.e. index 12) and
// runway-threshold (P/G) records for every fix the KAWO FL34 legs below
// reference by name. cifpParse.ts resolves leg positions via these, keyed by
// fixId (cols 14-18, index 13) / lat (cols 33-41, index 32) / lon (cols 42-51,
// index 41); P/G also carries the airport (cols 7-10, index 6).
const PC_AW = mkLine({ 4: 'P', 12: 'C', 13: 'AW', 32: 'N47500000', 41: 'W122200000' })
const PC_PAE = mkLine({ 4: 'P', 12: 'C', 13: 'PAE', 32: 'N47600000', 41: 'W122300000' })
const PC_SAVOY = mkLine({ 4: 'P', 12: 'C', 13: 'SAVOY', 32: 'N48000000', 41: 'W122100000' })
const PC_WATON = mkLine({ 4: 'P', 12: 'C', 13: 'WATON', 32: 'N48050000', 41: 'W122150000' })
const PG_RW34 = mkLine({ 4: 'P', 12: 'G', 6: 'KAWO', 13: 'RW34', 32: 'N48070000', 41: 'W122160000' })

// Real KAWO FL34 procedure-leg records — verbatim from cifpParseCore.test.ts.
// AW transition: IF at the AW NDB fix, then the procedure turn (PI).
const AAW_010_IF =
  'SUSAP KAWOK1FL34   AAW    010AW   K1PN0N       IF                                 - 06000     18000                 0 NS   281442203'
const AAW_020_PI =
  'SUSAP KAWOK1FL34   AAW    020AW   K1PN0NE AL   PI IAWOK1      1621005720710100PI  + 02000                           0 NS   281451308'
// PAE transition: no course reversal — the NoPT route.
const APAE_010_IAF =
  'SUSAP KAWOK1FL34   APAE   010PAE  K1D 0V  A    FC PAE K1      0000000003660041D   + 02000     18000                 0 NS   281461308'
const APAE_020_IF =
  'SUSAP KAWOK1FL34   APAE   020SAVOYK1PC0EE B    CF IAWOK1      1621011803660020PI  + 02000                           0 NS   281471310'
// Final (blank transition): FACF, FAF, MAP, then the missed approach.
const FINAL_010_FACF =
  'SUSAP KAWOK1FL34   L      010SAVOYK1PC0E  I    IF IAWOK1      16210118        PI  + 02000     18000                 0 NS   281481310'
const FINAL_020_FAF =
  'SUSAP KAWOK1FL34   L      020WATONK1EA0E  F    CF IAWOK1      1621005734200060PI  + 01700                 AW    K1PN0 NS   281491308'
const FINAL_030_MAP =
  'SUSAP KAWOK1FL34   L      030RW34 K1PG0GY M    CF IAWOK1      1621001034200047PI    00174             -305          0 NS   281501308'
const FINAL_060_HM =
  'SUSAP KAWOK1FL34   L      060AW   K1PN0NE  L   HM                     3421T010    + 02000                           0 NS   281531308'

const FIXTURE_TEXT = [
  PA_KAWO,
  PC_AW,
  PC_PAE,
  PC_SAVOY,
  PC_WATON,
  PG_RW34,
  AAW_010_IF,
  AAW_020_PI,
  APAE_010_IAF,
  APAE_020_IF,
  FINAL_010_FACF,
  FINAL_020_FAF,
  FINAL_030_MAP,
  FINAL_060_HM,
].join('\n')

describe('parseCifp (KAWO FL34 end-to-end fixture)', () => {
  it('groups the KAWO airport with exactly one APPROACH procedure', () => {
    const result = parseCifp(FIXTURE_TEXT)
    expect(Object.keys(result)).toEqual(['KAWO'])
    expect(result.KAWO.procedures).toHaveLength(1)

    const proc = result.KAWO.procedures[0]
    expect(proc.id).toBe('KAWO-APPROACH-L34')
    expect(proc.icao).toBe('KAWO')
    expect(proc.name).toBe('L34')
    expect(proc.type).toBe('APPROACH')
    expect(proc.runways).toEqual(['34'])
    expect(proc.hasGeometry).toBe(true)
  })

  it('resolves the airport magnetic variation from the PA record (+17.0E)', () => {
    const result = parseCifp(FIXTURE_TEXT)
    expect(result.KAWO.magVarDeg).toBeCloseTo(17.0, 5)
    expect(result.KAWO.procedures[0].magVarDeg).toBeCloseTo(17.0, 5)
  })

  it('derives the VDA-sourced glide path (3.05 deg, from the MAP leg VDA)', () => {
    const proc = parseCifp(FIXTURE_TEXT).KAWO.procedures[0]
    expect(proc.gsSource).toBe('vda')
    expect(proc.gpaDeg).toBeCloseTo(3.05, 5)
  })

  it('derives the AW procedure-turn course reversal matching cifpParseCore\'s own derivation', () => {
    const proc = parseCifp(FIXTURE_TEXT).KAWO.procedures[0]
    expect(proc.courseReversal).toMatchObject({
      fixId: 'AW',
      transitionId: 'AW',
      turnRight: false,
      alt: { type: 'AT_OR_ABOVE', low: 2000 },
      entryAlt: { type: 'AT_OR_BELOW', low: 6000, high: 6000 },
    })
    expect(proc.courseReversal!.outboundCourseMag).toBeCloseTo(162.1, 5)
    expect(proc.courseReversal!.inboundCourseMag).toBeCloseTo(342.1, 5)
    expect(proc.courseReversal!.limitNm).toBeCloseTo(10.0, 5)
    // No HF leg in this fixture subset (that's the R34 hold-in-lieu case).
    expect(proc.holdInLieu).toBeUndefined()
  })

  it('keeps the AW and PAE transitions separate, with PAE inferred NoPT', () => {
    const proc = parseCifp(FIXTURE_TEXT).KAWO.procedures[0]
    const ids = proc.transitions!.map((t) => t.id)
    expect(ids).toEqual(['AW', 'PAE', '(common)'])
    expect(proc.transitions!.find((t) => t.id === 'PAE')!.noPt).toBe(true)
    expect(proc.transitions!.find((t) => t.id === 'AW')!.noPt).toBeUndefined()
  })

  it('assigns the FAF and MAP roles to WATON and RW34 respectively', () => {
    const proc = parseCifp(FIXTURE_TEXT).KAWO.procedures[0]
    const waton = proc.symbols.find((s) => s.id === 'WATON')!
    expect(waton.role).toBe('faf')
    expect(waton.alt).toEqual({ type: 'AT_OR_ABOVE', low: 1700 })

    const rw34 = proc.symbols.find((s) => s.id === 'RW34')!
    expect(rw34.role).toBe('map')
    expect(rw34.navaidType).toBe('RUNWAY')
  })

  it('merges the runway threshold into runwayInfo, keyed by runway id', () => {
    const result = parseCifp(FIXTURE_TEXT)
    expect(result.KAWO.runwayInfo.RW34).toMatchObject({ id: 'RW34' })
    expect(result.KAWO.runwayInfo.RW34.lat).toBeCloseTo(48.1167, 3)
    expect(result.KAWO.runwayInfo.RW34.lon).toBeCloseTo(-122.2667, 3)
  })

  it('emits transition and missed-approach GeoJSON line features', () => {
    const proc = parseCifp(FIXTURE_TEXT).KAWO.procedures[0]
    const kinds = proc.geojson.features.map((f) => (f.properties as { kind: string }).kind)
    expect(kinds).toContain('path')
    expect(kinds).toContain('pt') // the AW procedure turn
  })

  it('invokes the progress callback and finishes at 100%', () => {
    const onProgress = vi.fn()
    parseCifp(FIXTURE_TEXT, onProgress)
    expect(onProgress).toHaveBeenCalled()
    const [lastPercent, lastMessage] = onProgress.mock.calls[onProgress.mock.calls.length - 1]
    expect(lastPercent).toBe(100)
    expect(lastMessage).toBe('Done.')
  })

  it('is deterministic: re-parsing the same text yields the same shape', () => {
    const a = parseCifp(FIXTURE_TEXT)
    const b = parseCifp(FIXTURE_TEXT)
    expect(a).toEqual(b)
  })
})
