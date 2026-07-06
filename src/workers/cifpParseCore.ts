/**
 * Pure ARINC 424 procedure-record parsing/derivation helpers used by the CIFP
 * worker (`cifpParser.worker.ts`). Kept in a plain module (no worker globals) so
 * the parsing logic is directly unit-testable. All column offsets are 0-based
 * slice bounds against a 132-char FAACIFP18 record; see the comments per field.
 */

import type { AltConstraint, Procedure, WaypointRole } from '../types/procedure'

export type SectionCode = 'P' | 'E' | 'D'
export type SubSectionCode = string

export interface Record424 {
  sectionCode: SectionCode
  subSectionCode: SubSectionCode
  airportIcao: string
  procedureId: string
  transitionId: string
  sequenceNumber: number
  fixId: string
  altDescriptor: string
  alt1: string
  alt2: string
  pathTerm: string // path & terminator, cols 48-49 (e.g. CF, TF, HM, HF, PI)
  descCode4: string // waypoint description code position 4, col 43 (A/B/C/D/F/I/M/H)
  flyover: boolean // waypoint description code position 2, col 41 ('Y' = flyover)
  turnDir: string // col 44 (L/R)
  recNav: string // cols 51-54 (recommended navaid — the DME reference)
  rho: string // cols 67-70 (DME distance to fix from navaid, tenths of nm)
  magCourse: string // cols 71-74 (tenths of a degree)
  legLen: string // cols 75-78 (route distance / holding leg)
  vertAngle: string // cols 103-106 (signed hundredths of a degree, VDA)
  speedLimit: string // cols 100-102 (knots, a maximum)
}

/** Normalize a bearing to [0, 360). */
export function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360
}

export function parseProcRecord(line: string): Record424 | null {
  if (line.length < 132) return null
  const sectionCode = line[4] as SectionCode
  if (sectionCode !== 'P') return null
  // Airport-section subsection is at column 13 (index 12):
  //   D = SID, E = STAR, F = Approach. Everything else (C terminal waypoint,
  //   G runway, I ILS, P path point, S MSA) is not a procedure leg.
  const subSection = line[12]
  if (!'DEF'.includes(subSection)) return null

  const airportIcao = line.slice(6, 10).trim()
  if (!airportIcao) return null

  // Continuation record number, col 39. '0' = standalone, '1' = first record of
  // a continued set; anything else ('2'-'9', 'A'-'Z') is a continuation record
  // (e.g. the SBAS FAS-data 'W' continuation on RNAV FAF legs). Continuations
  // reuse the primary's sequence number with leg fields blank — parsing one
  // would overwrite the real leg (KAWO R34 YAYKU lost its FAF role and 1700'
  // constraint this way).
  const continuation = line[38]
  if (continuation !== '0' && continuation !== '1') return null

  return {
    sectionCode,
    subSectionCode: subSection,
    airportIcao,
    procedureId: line.slice(13, 19).trim(),
    transitionId: line.slice(20, 25).trim(),
    sequenceNumber: parseInt(line.slice(26, 29).trim()) || 0,
    fixId: line.slice(29, 34).trim(),
    altDescriptor: line.slice(82, 83),
    alt1: line.slice(84, 89).trim(),
    alt2: line.slice(89, 94).trim(),
    pathTerm: line.slice(47, 49).trim(),
    descCode4: line[42] ?? ' ',
    flyover: (line[40] ?? ' ') === 'Y',
    turnDir: line[43] ?? ' ',
    recNav: line.slice(50, 54).trim(),
    rho: line.slice(66, 70).trim(),
    magCourse: line.slice(70, 74).trim(),
    legLen: line.slice(74, 78).trim(),
    vertAngle: line.slice(102, 106).trim(),
    speedLimit: line.slice(99, 102).trim(),
  }
}

/**
 * Map an ARINC 424 waypoint description (position-4 code + path/terminator) to a
 * renderable role. Position-4 codes on approach fixes:
 *   A = IAF, B = IF, C = IAF-with-hold, D = IAF-with-FACF, F = FAF, I = FACF/IF,
 *   M = MAP, H = holding fix.
 */
export function legRole(descCode4: string, pathTerm: string): WaypointRole {
  if (descCode4 === 'A' || descCode4 === 'C' || descCode4 === 'D') return 'iaf'
  if (descCode4 === 'B' || descCode4 === 'I') return 'if'
  if (descCode4 === 'F') return 'faf'
  if (descCode4 === 'M') return 'map'
  if (descCode4 === 'H' || pathTerm === 'HM' || pathTerm === 'HF' || pathTerm === 'HA') return 'hold'
  return 'normal'
}

/** Parse the holding/PT leg length: "T010" = 1.0 min (→ ~4nm), "0040" = 4.0nm. */
export function parseLegLen(legLen: string): number {
  if (!legLen) return 0
  if (legLen[0] === 'T') {
    const minutes = (parseInt(legLen.slice(1)) || 0) / 10
    return minutes * 4 // ~4nm per minute at holding speed
  }
  return (parseInt(legLen) || 0) / 10
}

/**
 * Leg vertical descent angle (VDA) in degrees. Raw field is signed hundredths of
 * a degree ("-305" => -3.05). Returns the descent magnitude (always positive);
 * null when the field is blank or zero.
 */
export function parseVertAngleDeg(raw: string): number | null {
  const t = raw.trim()
  if (!t) return null
  const n = parseInt(t, 10)
  if (Number.isNaN(n) || n === 0) return null
  return Math.abs(n) / 100
}

export interface PiData {
  outboundCourseMag: number
  inboundCourseMag: number
  barbCourseMag: number
  limitNm: number
}

/**
 * Derive procedure-turn geometry from the raw PI-leg fields. The coded magCourse
 * of a PI leg is the 45° BARB course, not the outbound course; legLen is the
 * "remain within" excursion limit. Outbound = barb − 45° for a left turn, barb +
 * 45° for a right turn; inbound is the reciprocal of outbound. All magnetic.
 */
export function derivePi(barbCourseMag: number, turnRight: boolean, limitNm: number): PiData {
  const outboundCourseMag = norm360(barbCourseMag + (turnRight ? 45 : -45))
  const inboundCourseMag = norm360(outboundCourseMag + 180)
  return { outboundCourseMag, inboundCourseMag, barbCourseMag, limitNm }
}

/** A leg carries a course reversal when it is a procedure turn (PI) or a hold-in-lieu (HF). */
export function isCourseReversalLeg(pathTerm: string): boolean {
  return pathTerm === 'PI' || pathTerm === 'HF'
}

/**
 * Glide-path angle from a coded leg vertical descent angle (VDA), for
 * approaches with no path point and no ILS glide slope. Scans each transition
 * that reaches the MAP and returns the VDA on the latest final-approach leg
 * carrying one (typically the runway/MAP leg). Null when no leg codes a VDA.
 */
export function deriveVdaGpaDeg(
  transitions: Array<{ legs: Array<{ role: WaypointRole; vertAngleDeg?: number | null }> }>,
): number | null {
  for (const { legs } of transitions) {
    const mapIdx = legs.findIndex((l) => l.role === 'map')
    if (mapIdx < 0) continue
    for (let i = mapIdx; i >= 0; i--) {
      const va = legs[i].vertAngleDeg
      if (va != null) return va
    }
  }
  return null
}

/** The minimal leg shape `deriveCourseReversal` needs (structural subset of ProcedureLeg). */
export interface ReversalLegLike {
  fixId: string
  pathTerm: string
  turnRight: boolean
  altConstraint: AltConstraint | null
  pi?: PiData
}

/**
 * Course-reversal metadata for an approach that publishes a procedure turn:
 * the first PI leg's derived courses/limit plus its own crossing constraint
 * (`alt`) and the constraint on the IF leg at the same fix in the same
 * transition (`entryAlt` — the altitude arriving at the turn fix). Null when
 * the procedure has no PI leg.
 */
export function deriveCourseReversal(
  transitions: Array<{ id: string; legs: ReversalLegLike[] }>,
): NonNullable<Procedure['courseReversal']> | null {
  for (const { id, legs } of transitions) {
    const piLeg = legs.find((l) => l.pathTerm === 'PI' && l.pi)
    if (!piLeg || !piLeg.pi) continue
    const entryLeg = legs.find((l) => l !== piLeg && l.fixId === piLeg.fixId && l.pathTerm === 'IF')
    return {
      fixId: piLeg.fixId,
      transitionId: id,
      outboundCourseMag: piLeg.pi.outboundCourseMag,
      inboundCourseMag: piLeg.pi.inboundCourseMag,
      turnRight: piLeg.turnRight,
      limitNm: piLeg.pi.limitNm,
      alt: piLeg.altConstraint,
      entryAlt: entryLeg?.altConstraint ?? null,
    }
  }
  return null
}

/** The minimal leg shape `deriveHoldInLieu` needs (structural subset of ProcedureLeg). */
export interface HoldLegLike {
  fixId: string
  pathTerm: string
  turnRight: boolean
  course: number
  legNm: number
  altConstraint: AltConstraint | null
}

/**
 * Hold-in-lieu-of-procedure-turn (HILPT) metadata for an approach that
 * publishes an HF leg: the hold fix, its inbound course (the coded magnetic
 * course of the HF leg) and derived outbound reciprocal, turn direction, leg
 * length, and the leg's own crossing constraint. The HF leg is usually its
 * own single-leg transition named after the fix (e.g. KAWO R34's "SAVOY").
 * Null when the procedure has no HF leg.
 */
export function deriveHoldInLieu(
  transitions: Array<{ id: string; legs: HoldLegLike[] }>,
): NonNullable<Procedure['holdInLieu']> | null {
  for (const { id, legs } of transitions) {
    const hf = legs.find((l) => l.pathTerm === 'HF')
    if (!hf) continue
    return {
      fixId: hf.fixId,
      transitionId: id,
      inboundCourseMag: hf.course,
      outboundCourseMag: norm360(hf.course + 180),
      turnRight: hf.turnRight,
      legNm: hf.legNm,
      alt: hf.altConstraint,
    }
  }
  return null
}

/**
 * Infer which transitions are NoPT routes. For approaches only: when some
 * transition of the procedure contains a course reversal (PI or HF leg), every
 * OTHER named enroute transition (not the blank/common final one, not the one
 * carrying the reversal itself) is a NoPT route. Returns the set of NoPT ids.
 */
export function computeNoPtTransitionIds(
  transitions: Array<{ id: string; legs: Array<{ pathTerm: string }> }>,
  isApproach: boolean,
): Set<string> {
  const noPt = new Set<string>()
  if (!isApproach) return noPt

  const hasReversalAnywhere = transitions.some((t) => t.legs.some((l) => isCourseReversalLeg(l.pathTerm)))
  if (!hasReversalAnywhere) return noPt

  for (const t of transitions) {
    if (t.id === '(common)' || t.id === '') continue // blank/common final segment
    if (t.legs.some((l) => isCourseReversalLeg(l.pathTerm))) continue // this is the reversal route
    noPt.add(t.id)
  }
  return noPt
}
