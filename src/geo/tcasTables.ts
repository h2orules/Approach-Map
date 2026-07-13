// RTCA DO-185B TCAS II sensitivity-level (SL) table. Each row's TA/RA
// thresholds (tau, DMOD, ZTHR) and RA-specific ALIM widen with altitude: closer
// to the ground, traffic is denser and alerts must stay tight (and below
// 1000 ft AGL there is no RA tier at all — an aircraft that low is assumed to
// be landing, and TCAS never issues resolution advisories that close to the
// runway). Bands 2–3 gate on the owner aircraft's own AGL; bands 4–8 gate on
// MSL once it's climbed above 2350 ft AGL.
//
// `sl` is DO-185B's own sensitivity-level number for rows 2–7. DO-185B's real
// table caps at SL7 (>42000 MSL still uses SL7's tau/DMOD, just a taller ZTHR/
// ALIM). This table instead gives the >42000 ft band its own row so every band
// has an exact numeric identity; it is *not* an official DO-185B sensitivity
// level and is represented as `sl: 8` purely so `sensitivityLevelFor` and its
// tests can address it distinctly from SL7.
export interface TcasSL {
  sl: number
  taTauS: number
  taDmodNm: number
  taZthrFt: number
  raTauS: number | null
  raDmodNm: number | null
  raZthrFt: number | null
  alimFt: number | null
}

export const TCAS_SL_TABLE: TcasSL[] = [
  // SL2: <1000 ft AGL — TA only, no RA (too close to the ground to maneuver).
  { sl: 2, taTauS: 20, taDmodNm: 0.3, taZthrFt: 850, raTauS: null, raDmodNm: null, raZthrFt: null, alimFt: null },
  // SL3: 1000–2350 ft AGL.
  { sl: 3, taTauS: 25, taDmodNm: 0.33, taZthrFt: 850, raTauS: 15, raDmodNm: 0.2, raZthrFt: 600, alimFt: 300 },
  // SL4: above 2350 ft AGL and <5000 ft MSL.
  { sl: 4, taTauS: 30, taDmodNm: 0.48, taZthrFt: 850, raTauS: 20, raDmodNm: 0.35, raZthrFt: 600, alimFt: 300 },
  // SL5: 5000–10000 ft MSL.
  { sl: 5, taTauS: 40, taDmodNm: 0.75, taZthrFt: 850, raTauS: 25, raDmodNm: 0.55, raZthrFt: 600, alimFt: 350 },
  // SL6: 10000–20000 ft MSL.
  { sl: 6, taTauS: 45, taDmodNm: 1.0, taZthrFt: 850, raTauS: 30, raDmodNm: 0.8, raZthrFt: 600, alimFt: 400 },
  // SL7: 20000–42000 ft MSL.
  { sl: 7, taTauS: 48, taDmodNm: 1.3, taZthrFt: 850, raTauS: 35, raDmodNm: 1.1, raZthrFt: 700, alimFt: 600 },
  // SL8 (not an official DO-185B level — see file header): >42000 ft MSL.
  { sl: 8, taTauS: 48, taDmodNm: 1.3, taZthrFt: 1200, raTauS: 35, raDmodNm: 1.1, raZthrFt: 800, alimFt: 700 },
]

/**
 * Selects the DO-185B sensitivity level for one aircraft. `ownAglFt` (height
 * above the nearest relevant airport) decides the low-altitude bands (SL2/
 * SL3); once above 2350 ft AGL, `ownAltMslFt` decides the rest. Band edges are
 * inclusive on their lower bound (matching how the bands were specified: e.g.
 * exactly 1000 ft AGL is already SL3, exactly 20000 ft MSL is already SL7).
 */
export function sensitivityLevelFor(ownAltMslFt: number, ownAglFt: number): TcasSL {
  if (ownAglFt < 1000) return TCAS_SL_TABLE[0] // SL2
  if (ownAglFt <= 2350) return TCAS_SL_TABLE[1] // SL3
  if (ownAltMslFt < 5000) return TCAS_SL_TABLE[2] // SL4
  if (ownAltMslFt < 10000) return TCAS_SL_TABLE[3] // SL5
  if (ownAltMslFt < 20000) return TCAS_SL_TABLE[4] // SL6
  if (ownAltMslFt <= 42000) return TCAS_SL_TABLE[5] // SL7
  return TCAS_SL_TABLE[6] // SL8
}
