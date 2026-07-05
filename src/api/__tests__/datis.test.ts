import { describe, it, expect } from 'vitest'
import {
  parseAtisText,
  parseDatisEntries,
  arrivalSummary,
  PREFIX_READABLE,
  type DatisEntry,
} from '../datis'

describe('parseAtisText', () => {
  it('scopes approach types to the clause they appear in ("ILS RWY 16L, RNAV RWY 16R")', () => {
    const info = parseAtisText(
      'SEA ATIS INFO Q 1753Z. ILS RWY 16L, RNAV RWY 16R APCHS IN USE.',
    )
    expect(info.code).toBe('Q')
    expect(info.runwayPrefs).toEqual({ '16L': ['I'], '16R': ['R'] })
  })

  it('broadcasts a single approach type across a multi-runway clause ("SIMUL ILS ... RWYS 16L AND 16C")', () => {
    const info = parseAtisText(
      'SEA ATIS INFO Q 1753Z. SIMUL ILS APCHS IN USE RWYS 16L AND 16C.',
    )
    expect(info.runwayPrefs).toEqual({ '16L': ['I'], '16C': ['I'] })
  })

  it('does not leak approach types across sentences (split KSEA arr wording)', () => {
    const info = parseAtisText(
      'SIMUL ILS APCHS IN USE RWYS 16L AND 16C. RNAV RWY 16R APCH IN USE.',
    )
    expect(info.runwayPrefs['16L']).toEqual(['I'])
    expect(info.runwayPrefs['16C']).toEqual(['I'])
    expect(info.runwayPrefs['16R']).toEqual(['R'])
    expect(info.runwayPrefs['16R']).not.toContain('I')
  })

  it('preserves text order for combined approach types ("ILS OR LOC RWY 34C")', () => {
    const info = parseAtisText('ILS OR LOC RWY 34C APCH IN USE.')
    expect(info.runwayPrefs['34C']).toEqual(['I', 'L'])
  })

  it('routes VISUAL clauses to visualRunways, not runwayPrefs', () => {
    const info = parseAtisText('VISUAL APCHS IN USE RWY 34C.')
    expect(info.visualRunways).toEqual(['34C'])
    expect(info.runwayPrefs).toEqual({})
  })

  it('accepts plural VISUALS', () => {
    const info = parseAtisText('VISUALS RWY 28L AND 28R IN USE.')
    expect(info.visualRunways).toEqual(['28L', '28R'])
  })

  it('recognizes DEPARTURES (not just DEP/DEPARTING/DEPARTURE)', () => {
    const info = parseAtisText('DEPARTURES RUNWAY 01R.')
    expect(info.depRunways).toEqual(['01R'])
  })

  it('maps RNP to the RNAV (R) prefix', () => {
    const info = parseAtisText('RNP RWY 34C APCH IN USE.')
    expect(info.runwayPrefs['34C']).toEqual(['R'])
  })

  it('rejects out-of-range runway numbers (RWY 45)', () => {
    const info = parseAtisText('ILS RWY 45 APCH IN USE.')
    expect(info.runwayPrefs).toEqual({})
  })

  it('does not match single-digit runways (documented limitation: "RWY 1R")', () => {
    // The two-digit runway regex intentionally does not match single-digit
    // designators like "1R" (vs. "01R") — preserved from prior behavior.
    const info = parseAtisText('ILS RWY 1R APCH IN USE.')
    expect(info.runwayPrefs).toEqual({})
  })

  it('handles a full combined-ATIS broadcast (arr + dep in one entry) without throwing', () => {
    const info = parseAtisText(
      'SEA ATIS INFO Q 1753Z. 16011KT 10SM FEW045 OVC250 14/07 A3003 (THREE ZERO ZERO THREE). ' +
      'SIMUL ILS APCHS IN USE RWYS 16L AND 16C. RNAV RWY 16R APCH IN USE. DEPG RWYS 16L, 16C.',
    )
    expect(info.code).toBe('Q')
    expect(info.runwayPrefs['16L']).toEqual(['I'])
    expect(info.runwayPrefs['16C']).toEqual(['I'])
    expect(info.runwayPrefs['16R']).toEqual(['R'])
    expect(info.depRunways).toEqual(['16L', '16C'])
  })

  it('returns code "?" for unparseable garbage without throwing', () => {
    expect(() => parseAtisText('asdf 1234 !!! not an atis at all')).not.toThrow()
    const info = parseAtisText('asdf 1234 !!! not an atis at all')
    expect(info.code).toBe('?')
    expect(info.runwayPrefs).toEqual({})
    expect(info.depRunways).toEqual([])
    expect(info.visualRunways).toEqual([])
  })
})

describe('arrivalSummary', () => {
  it('groups runways by type', () => {
    const info = parseAtisText('ILS RWY 16R, ILS RWY 16L APCHS IN USE.')
    expect(arrivalSummary(info)).toBe(`${PREFIX_READABLE.I} 16R 16L`)
  })

  it('appends a VIS segment for visual runways', () => {
    const info = parseAtisText(
      'ILS RWY 16R APCH IN USE. VISUAL RWYS 28L AND 28R IN USE.',
    )
    expect(arrivalSummary(info)).toBe('ILS 16R · VIS 28L 28R')
  })
})

describe('parseDatisEntries', () => {
  it('merges a split arr + dep entry pair, unioning dep runways and joining raw with a blank line', () => {
    const entries: DatisEntry[] = [
      {
        airport: 'KSEA',
        type: 'arr',
        code: 'Q',
        datis: 'SEA ARR ATIS INFO Q 1753Z. SIMUL ILS APCHS IN USE RWYS 16L AND 16C. RNAV RWY 16R APCH IN USE.',
      },
      {
        airport: 'KSEA',
        type: 'dep',
        code: 'Q',
        datis: 'SEA DEP ATIS INFO Q 1753Z. DEPG RWYS 16L, 16C.',
      },
    ]
    const info = parseDatisEntries(entries)
    expect(info).not.toBeNull()
    expect(info!.code).toBe('Q')
    expect(info!.runwayPrefs['16L']).toEqual(['I'])
    expect(info!.runwayPrefs['16C']).toEqual(['I'])
    expect(info!.runwayPrefs['16R']).toEqual(['R'])
    expect(info!.depRunways).toEqual(['16L', '16C'])
    expect(info!.raw).toBe(`${entries[0].datis}\n\n${entries[1].datis}`)
  })

  it('unions dep runways mentioned in the arr entry with those in a separate dep entry', () => {
    const entries: DatisEntry[] = [
      {
        airport: 'KSEA',
        type: 'arr',
        code: 'Q',
        datis: 'ILS RWY 16L APCH IN USE. DEPG RWY 16C.',
      },
      {
        airport: 'KSEA',
        type: 'dep',
        code: 'Q',
        datis: 'DEPG RWY 16R.',
      },
    ]
    const info = parseDatisEntries(entries)
    expect(info!.depRunways).toEqual(['16C', '16R'])
  })

  it('parses a combined-only entry the same as parseAtisText', () => {
    const entries: DatisEntry[] = [
      {
        airport: 'KSEA',
        type: 'combined',
        code: 'Q',
        datis: 'SEA ATIS INFO Q 1753Z. ILS RWY 16L APCH IN USE. DEPG RWY 16R.',
      },
    ]
    const info = parseDatisEntries(entries)
    expect(info!.code).toBe('Q')
    expect(info!.runwayPrefs).toEqual({ '16L': ['I'] })
    expect(info!.depRunways).toEqual(['16R'])
    expect(info!.raw).toBe(entries[0].datis)
  })

  it('falls back to entries[0] when no arr/dep/combined type is recognized', () => {
    const entries: DatisEntry[] = [
      { airport: 'KSEA', type: 'weird', code: 'Q', datis: 'ILS RWY 16L APCH IN USE.' } as DatisEntry,
    ]
    const info = parseDatisEntries(entries)
    expect(info!.runwayPrefs).toEqual({ '16L': ['I'] })
  })

  it('returns null for an empty entries array', () => {
    expect(parseDatisEntries([])).toBeNull()
  })
})
