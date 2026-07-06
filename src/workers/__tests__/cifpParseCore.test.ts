import { describe, it, expect } from 'vitest'
import {
  parseProcRecord,
  legRole,
  parseLegLen,
  parseVertAngleDeg,
  derivePi,
  isCourseReversalLeg,
  computeNoPtTransitionIds,
  deriveVdaGpaDeg,
  deriveCourseReversal,
  deriveHoldInLieu,
  type ReversalLegLike,
  type HoldLegLike,
} from '../cifpParseCore'
import { parseAirportMagVar, magneticToTrue } from '../../utils/arincRecords'
import { parseArinc424AltDescriptor } from '../../utils/altitudeConstraint'
import type { WaypointRole } from '../../types/procedure'

// All fixtures below are verbatim 132-char records from live FAA CIFP data
// (FAACIFP18): the KAWO LOC RWY 34 ("FL34") approach and the KAWO airport (PA)
// record. This approach is the reference case for procedure-turn semantics
// (PI leg on the AW transition), NoPT inference (PAE transition), the LOM FAF
// (WATON over the AW NDB), and the VDA-only glide path (no PP/GS records).

const PA_KAWO =
  'SUSAP KAWOK1AAWO     0     053YHN48093870W122093250E017000142         1800018000C    MNAR    ARLINGTON MUNI                281361109'
// AW transition: IF at the AW NDB, then the procedure turn (PI).
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
// KAWO RNAV (GPS) RWY 34 ("FR34") FAF: the primary record (continuation number
// '1', col 39) is followed by an SBAS FAS-data continuation record ('2', type
// 'W') that reuses sequence 020 with blank leg fields. The parser must reject
// the continuation or it overwrites the FAF's role and 1700' constraint.
const R34_020_FAF =
  'SUSAP KAWOK1FR34   R      020YAYKUK1PC1E  F 010TF                                 + 01700                 RW34  K1PGA JS   281682203'
const R34_020_FAF_CONT =
  'SUSAP KAWOK1FR34   R      020YAYKUK1PC2WALPV       ALNAV/VNAV ALNAV                                                   JS   281691310'
// KAWO R34 hold-in-lieu-of-PT: a single-leg HF transition at SAVOY (inbound
// 342.1° mag, left turns, 4 nm legs, cross at or above 2000).
const R34_HILPT_HF =
  'SUSAP KAWOK1FR34   ASAVOY 010SAVOYK1PC0EE AL   HF                     34210040    + 02000     18000                 A JS   281661310'

describe('parseProcRecord (KAWO FL34 fixture)', () => {
  it('extracts identity and leg fields from the PI leg', () => {
    const r = parseProcRecord(AAW_020_PI)!
    expect(r).not.toBeNull()
    expect(r.airportIcao).toBe('KAWO')
    expect(r.subSectionCode).toBe('F')
    expect(r.procedureId).toBe('L34')
    expect(r.transitionId).toBe('AW')
    expect(r.sequenceNumber).toBe(20)
    expect(r.fixId).toBe('AW')
    expect(r.pathTerm).toBe('PI')
    expect(r.descCode4).toBe('A')
    expect(r.turnDir).toBe('L')
    expect(r.recNav).toBe('IAWO')
    expect(r.magCourse).toBe('2071')
    expect(r.legLen).toBe('0100')
    expect(r.altDescriptor).toBe('+')
    expect(r.alt1).toBe('02000')
  })

  it('extracts the vertical angle field from the MAP leg (cols 103-106)', () => {
    const r = parseProcRecord(FINAL_030_MAP)!
    expect(r.vertAngle).toBe('-305')
    expect(r.descCode4).toBe('M')
    expect(r.magCourse).toBe('3420')
  })

  it('leaves vertAngle empty on legs without a VDA', () => {
    expect(parseProcRecord(FINAL_020_FAF)!.vertAngle).toBe('')
  })

  it('returns null for non-procedure records (PA airport record)', () => {
    expect(parseProcRecord(PA_KAWO)).toBeNull()
  })

  it('parses the KAWO R34 FAF primary record (continuation number 1)', () => {
    const r = parseProcRecord(R34_020_FAF)!
    expect(r).not.toBeNull()
    expect(r.fixId).toBe('YAYKU')
    expect(r.descCode4).toBe('F')
    expect(r.altDescriptor).toBe('+')
    expect(r.alt1).toBe('01700')
    expect(legRole(r.descCode4, r.pathTerm)).toBe('faf')
    expect(parseArinc424AltDescriptor(r.altDescriptor, r.alt1, r.alt2)).toEqual({
      type: 'AT_OR_ABOVE',
      low: 1700,
    })
  })

  it('rejects continuation records (SBAS FAS data on the R34 FAF) so they cannot overwrite the primary leg', () => {
    expect(parseProcRecord(R34_020_FAF_CONT)).toBeNull()
  })
})

describe('legRole', () => {
  it('maps description-code-4 A/C/D to iaf', () => {
    expect(legRole(parseProcRecord(APAE_010_IAF)!.descCode4, 'FC')).toBe('iaf')
    expect(legRole('C', 'TF')).toBe('iaf') // IAF with hold
    expect(legRole('D', 'TF')).toBe('iaf') // IAF with FACF
  })

  it('maps B (IF) and I (FACF) to if', () => {
    const b = parseProcRecord(APAE_020_IF)!
    expect(legRole(b.descCode4, b.pathTerm)).toBe('if')
    const i = parseProcRecord(FINAL_010_FACF)!
    expect(legRole(i.descCode4, i.pathTerm)).toBe('if')
  })

  it('maps F to faf and M to map', () => {
    const f = parseProcRecord(FINAL_020_FAF)!
    expect(legRole(f.descCode4, f.pathTerm)).toBe('faf')
    const m = parseProcRecord(FINAL_030_MAP)!
    expect(legRole(m.descCode4, m.pathTerm)).toBe('map')
  })

  it('maps holding legs (HM path terminator) to hold', () => {
    const h = parseProcRecord(FINAL_060_HM)!
    expect(legRole(h.descCode4, h.pathTerm)).toBe('hold')
  })

  it('maps an unadorned leg to normal', () => {
    const n = parseProcRecord(AAW_010_IF)!
    expect(legRole(n.descCode4, n.pathTerm)).toBe('normal')
  })
})

describe('derivePi (procedure-turn semantics)', () => {
  it('derives outbound/inbound from the coded barb course (KAWO: 207.1 L → 162.1 out / 342.1 in)', () => {
    const rec = parseProcRecord(AAW_020_PI)!
    const barb = (parseInt(rec.magCourse) || 0) / 10
    const turnRight = rec.turnDir !== 'L'
    const limitNm = parseLegLen(rec.legLen)
    expect(barb).toBeCloseTo(207.1, 5)
    expect(turnRight).toBe(false)
    const pi = derivePi(barb, turnRight, limitNm)
    expect(pi.outboundCourseMag).toBeCloseTo(162.1, 5)
    expect(pi.inboundCourseMag).toBeCloseTo(342.1, 5)
    expect(pi.barbCourseMag).toBeCloseTo(207.1, 5)
    expect(pi.limitNm).toBeCloseTo(10.0, 5) // "remain within" excursion limit
  })

  it('adds 45° for a right turn and wraps through north', () => {
    const pi = derivePi(340, true, 8)
    expect(pi.outboundCourseMag).toBeCloseTo(25, 5)
    expect(pi.inboundCourseMag).toBeCloseTo(205, 5)
  })
})

describe('shape courses are converted magnetic → true', () => {
  it('KAWO PA record magvar parses as +17.0 east', () => {
    expect(parseAirportMagVar(PA_KAWO)).toBeCloseTo(17.0, 5)
  })

  it('PT outbound and hold inbound become true courses with the airport magvar', () => {
    const magVar = parseAirportMagVar(PA_KAWO)
    const pi = derivePi(207.1, false, 10)
    // Chart: 162° outbound magnetic → 179.1 true at KAWO (+17E).
    expect(magneticToTrue(pi.outboundCourseMag, magVar)).toBeCloseTo(179.1, 5)
    // Missed-approach hold inbound 342.1 magnetic → 359.1 true.
    const hold = parseProcRecord(FINAL_060_HM)!
    const inboundMag = (parseInt(hold.magCourse) || 0) / 10
    expect(magneticToTrue(inboundMag, magVar)).toBeCloseTo(359.1, 5)
  })
})

describe('computeNoPtTransitionIds', () => {
  const toLeg = (line: string) => ({ pathTerm: parseProcRecord(line)!.pathTerm })
  const kawoTransitions = [
    { id: 'AW', legs: [AAW_010_IF, AAW_020_PI].map(toLeg) },
    { id: 'PAE', legs: [APAE_010_IAF, APAE_020_IF].map(toLeg) },
    { id: '(common)', legs: [FINAL_010_FACF, FINAL_020_FAF, FINAL_030_MAP, FINAL_060_HM].map(toLeg) },
  ]

  it('marks PAE (no reversal) NoPT, not AW (carries the PI) nor the common transition', () => {
    const noPt = computeNoPtTransitionIds(kawoTransitions, true)
    expect(noPt.has('PAE')).toBe(true)
    expect(noPt.has('AW')).toBe(false)
    expect(noPt.has('(common)')).toBe(false)
    expect(noPt.size).toBe(1)
  })

  it('marks nothing when the procedure has no course reversal', () => {
    const noReversal = kawoTransitions.map((t) => ({
      ...t,
      legs: t.legs.filter((l) => l.pathTerm !== 'PI'),
    }))
    expect(computeNoPtTransitionIds(noReversal, true).size).toBe(0)
  })

  it('treats an HF leg (hold-in-lieu of PT) as a course reversal', () => {
    expect(isCourseReversalLeg('HF')).toBe(true)
    expect(isCourseReversalLeg('HM')).toBe(false)
    const hf = [
      { id: 'ABC', legs: [{ pathTerm: 'TF' }, { pathTerm: 'HF' }] },
      { id: 'XYZ', legs: [{ pathTerm: 'TF' }] },
      { id: '(common)', legs: [{ pathTerm: 'CF' }] },
    ]
    const noPt = computeNoPtTransitionIds(hf, true)
    expect(noPt.has('XYZ')).toBe(true)
    expect(noPt.has('ABC')).toBe(false)
  })

  it('never marks SID/STAR transitions', () => {
    expect(computeNoPtTransitionIds(kawoTransitions, false).size).toBe(0)
  })
})

// Build the same minimal leg the worker builds, from a raw record line — role,
// constraint, PI derivation and VDA all via the production code paths.
function legFromLine(line: string): ReversalLegLike & { role: WaypointRole; vertAngleDeg: number | null } {
  const r = parseProcRecord(line)!
  const turnRight = r.turnDir !== 'L'
  const courseMag = (parseInt(r.magCourse) || 0) / 10
  return {
    fixId: r.fixId,
    pathTerm: r.pathTerm,
    turnRight,
    role: legRole(r.descCode4, r.pathTerm),
    altConstraint: parseArinc424AltDescriptor(r.altDescriptor, r.alt1, r.alt2),
    vertAngleDeg: parseVertAngleDeg(r.vertAngle),
    ...(r.pathTerm === 'PI' ? { pi: derivePi(courseMag, turnRight, parseLegLen(r.legLen)) } : {}),
  }
}

const kawoLegTransitions = [
  { id: 'AW', legs: [AAW_010_IF, AAW_020_PI].map(legFromLine) },
  { id: 'PAE', legs: [APAE_010_IAF, APAE_020_IF].map(legFromLine) },
  { id: '(common)', legs: [FINAL_010_FACF, FINAL_020_FAF, FINAL_030_MAP, FINAL_060_HM].map(legFromLine) },
]

describe('deriveVdaGpaDeg', () => {
  it('KAWO FL34 gets its glide path from the MAP leg VDA (3.05°)', () => {
    expect(deriveVdaGpaDeg(kawoLegTransitions)).toBeCloseTo(3.05, 5)
  })

  it('returns null when no final-approach leg codes a VDA', () => {
    const noVda = kawoLegTransitions.map((t) => ({
      legs: t.legs.map((l) => ({ role: l.role, vertAngleDeg: null })),
    }))
    expect(deriveVdaGpaDeg(noVda)).toBeNull()
  })
})

describe('deriveCourseReversal', () => {
  it('KAWO FL34: PI at AW on the AW transition with PT alt +2000 and entry alt -6000', () => {
    const cr = deriveCourseReversal(kawoLegTransitions)!
    expect(cr).not.toBeNull()
    expect(cr.fixId).toBe('AW')
    expect(cr.transitionId).toBe('AW')
    expect(cr.outboundCourseMag).toBeCloseTo(162.1, 5)
    expect(cr.inboundCourseMag).toBeCloseTo(342.1, 5)
    expect(cr.turnRight).toBe(false)
    expect(cr.limitNm).toBeCloseTo(10.0, 5)
    expect(cr.alt).toEqual({ type: 'AT_OR_ABOVE', low: 2000 })
    expect(cr.entryAlt).toEqual({ type: 'AT_OR_BELOW', low: 6000, high: 6000 })
  })

  it('returns null when the procedure has no PI leg', () => {
    const noPi = kawoLegTransitions.map((t) => ({ id: t.id, legs: t.legs.filter((l) => l.pathTerm !== 'PI') }))
    expect(deriveCourseReversal(noPi)).toBeNull()
  })
})

describe('deriveHoldInLieu', () => {
  const holdLegFromLine = (line: string): HoldLegLike => {
    const r = parseProcRecord(line)!
    return {
      fixId: r.fixId,
      pathTerm: r.pathTerm,
      turnRight: r.turnDir !== 'L',
      course: (parseInt(r.magCourse) || 0) / 10,
      legNm: parseLegLen(r.legLen),
      altConstraint: parseArinc424AltDescriptor(r.altDescriptor, r.alt1, r.alt2),
    }
  }

  it('KAWO R34: HF at SAVOY on its single-leg transition — 342.1 in / 162.1 out, left, 4 nm, ≥2000', () => {
    const transitions = [
      { id: 'PAE', legs: [APAE_010_IAF, APAE_020_IF].map(holdLegFromLine) },
      { id: 'SAVOY', legs: [R34_HILPT_HF].map(holdLegFromLine) },
      { id: '(common)', legs: [FINAL_010_FACF, R34_020_FAF, FINAL_030_MAP].map(holdLegFromLine) },
    ]
    const h = deriveHoldInLieu(transitions)!
    expect(h).not.toBeNull()
    expect(h.fixId).toBe('SAVOY')
    expect(h.transitionId).toBe('SAVOY')
    expect(h.inboundCourseMag).toBeCloseTo(342.1, 5)
    expect(h.outboundCourseMag).toBeCloseTo(162.1, 5)
    expect(h.turnRight).toBe(false)
    expect(h.legNm).toBeCloseTo(4.0, 5)
    expect(h.alt).toEqual({ type: 'AT_OR_ABOVE', low: 2000 })
  })

  it('the single-leg HF transition marks the other enroute transition NoPT', () => {
    const transitions = [
      { id: 'PAE', legs: [APAE_010_IAF, APAE_020_IF].map((l) => ({ pathTerm: parseProcRecord(l)!.pathTerm })) },
      { id: 'SAVOY', legs: [{ pathTerm: parseProcRecord(R34_HILPT_HF)!.pathTerm }] },
      { id: '(common)', legs: [FINAL_010_FACF, R34_020_FAF, FINAL_030_MAP].map((l) => ({ pathTerm: parseProcRecord(l)!.pathTerm })) },
    ]
    const noPt = computeNoPtTransitionIds(transitions, true)
    expect(noPt.has('PAE')).toBe(true)
    expect(noPt.has('SAVOY')).toBe(false)
    expect(noPt.size).toBe(1)
  })

  it('returns null when the procedure has no HF leg', () => {
    const noHf = [{ id: '(common)', legs: [FINAL_010_FACF, R34_020_FAF, FINAL_030_MAP].map(holdLegFromLine) }]
    expect(deriveHoldInLieu(noHf)).toBeNull()
  })
})

describe('parseVertAngleDeg', () => {
  it('parses signed hundredths of a degree to a positive descent angle', () => {
    expect(parseVertAngleDeg(parseProcRecord(FINAL_030_MAP)!.vertAngle)).toBeCloseTo(3.05, 5)
    expect(parseVertAngleDeg('-305')).toBeCloseTo(3.05, 5)
    expect(parseVertAngleDeg('-300')).toBeCloseTo(3.0, 5)
  })

  it('returns null for blank or zero fields', () => {
    expect(parseVertAngleDeg('')).toBeNull()
    expect(parseVertAngleDeg('    ')).toBeNull()
    expect(parseVertAngleDeg('0000')).toBeNull()
  })
})

describe('parseLegLen', () => {
  it('parses distance legs in tenths of nm', () => {
    expect(parseLegLen('0100')).toBeCloseTo(10.0, 5)
    expect(parseLegLen('0047')).toBeCloseTo(4.7, 5)
  })
  it('parses time legs (T010 = 1.0 min ≈ 4nm)', () => {
    expect(parseLegLen('T010')).toBeCloseTo(4.0, 5)
  })
})
