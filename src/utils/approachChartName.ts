// Maps CIFP approach procedure idents (e.g. "I16RZ", "R16LY", "VDM-A") to the
// matching d-TPP `chart_name` string (e.g. "ILS Z RWY 16R", "RNAV (GPS) Y RWY
// 16L", "VOR/DME-A") so we can look up the chart's amendment number.
//
// CIFP ident shape (straight-in): <type letter><runway digits><runway
// suffix?><variant letter?>, e.g. I16RZ = ILS, runway 16R, variant Z.
// Circling shape: <type token>-<letter>, e.g. VDM-A, NDB-C (no runway).

type TypeKey =
  | 'ILS'
  | 'RNAV_GPS'
  | 'RNAV_RNP'
  | 'LOC'
  | 'VOR_DME'
  | 'VOR'
  | 'NDB'
  | 'LDA'
  | 'TACAN'

const SINGLE_LETTER_TYPE: Record<string, TypeKey> = {
  I: 'ILS',
  R: 'RNAV_GPS',
  H: 'RNAV_RNP',
  L: 'LOC',
  D: 'VOR_DME',
  V: 'VOR',
  N: 'NDB',
  X: 'LDA',
  S: 'TACAN',
}

// Type tokens as they appear before the dash in circling idents (e.g.
// "VDM-A", "NDB-C"). Reuses the same TypeKey set as the straight-in idents.
const CIRCLING_TOKEN_TYPE: Record<string, TypeKey> = {
  VDM: 'VOR_DME',
  NDB: 'NDB',
  VOR: 'VOR',
  ILS: 'ILS',
  LOC: 'LOC',
  LDA: 'LDA',
  TACAN: 'TACAN',
}

const VARIANT_LETTERS = new Set(['Z', 'Y', 'X', 'W', 'V'])

interface ParsedIdent {
  typeKey: TypeKey
  runwayToken: string | null
  variantLetter: string | null
  circlingLetter: string | null
}

function parseIdent(ident: string): ParsedIdent | null {
  const normalized = ident.trim().toUpperCase()

  const circlingMatch = normalized.match(/^([A-Z]{2,6})-([A-Z])$/)
  if (circlingMatch) {
    const [, token, letter] = circlingMatch
    const typeKey = CIRCLING_TOKEN_TYPE[token]
    if (!typeKey) return null
    return { typeKey, runwayToken: null, variantLetter: null, circlingLetter: letter }
  }

  const straightMatch = normalized.match(/^([IRHLDVNXS])(\d{2}[LRC]?)?([ZYXWV])?$/)
  if (straightMatch) {
    const [, letter, runway, variant] = straightMatch
    const typeKey = SINGLE_LETTER_TYPE[letter]
    if (!typeKey) return null
    return {
      typeKey,
      runwayToken: runway ?? null,
      variantLetter: variant && VARIANT_LETTERS.has(variant) ? variant : null,
      circlingLetter: null,
    }
  }

  return null
}

function typeMatches(typeKey: TypeKey, name: string): boolean {
  switch (typeKey) {
    case 'ILS':
      // "ILS OR LOC RWY.." and "ILS RWY.." both count as an ILS match.
      return name.includes('ILS')
    case 'RNAV_GPS':
      return name.includes('RNAV') && name.includes('GPS')
    case 'RNAV_RNP':
      return name.includes('RNAV') && name.includes('RNP')
    case 'LOC':
      // "LOC/DME RWY.." counts; exclude composite ILS charts that merely
      // mention "LOC" as part of "ILS OR LOC".
      return name.includes('LOC') && !name.includes('ILS')
    case 'VOR_DME':
      return name.includes('VOR/DME') || name.includes('VOR-DME')
    case 'VOR':
      return name.includes('VOR') && !name.includes('VOR/DME') && !name.includes('VOR-DME')
    case 'NDB':
      return name.includes('NDB')
    case 'LDA':
      return name.includes('LDA')
    case 'TACAN':
      return name.includes('TACAN')
    default:
      return false
  }
}

function normalize(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, ' ')
}

export function matchChartName(
  proc: { name: string; runways: string[] },
  chartNames: string[],
): string | null {
  const parsed = parseIdent(proc.name)
  if (!parsed) return null

  const candidates = chartNames.filter((raw) => {
    const name = normalize(raw)
    if (!typeMatches(parsed.typeKey, name)) return false

    if (parsed.circlingLetter) {
      return new RegExp(`-${parsed.circlingLetter}\\b`).test(name)
    }

    if (parsed.runwayToken && !name.includes(`RWY ${parsed.runwayToken}`)) return false

    if (parsed.variantLetter && !new RegExp(`\\b${parsed.variantLetter}\\b`).test(name)) return false

    return true
  })

  if (candidates.length === 0) return null

  // Prefer the tightest structural match: no parenthetical qualifiers (e.g.
  // "(SA CAT I)"), then the shortest string, so a plain ident (e.g. "I16C")
  // picks the canonical chart ("ILS OR LOC RWY 16C") over a special-category
  // variant chart that happens to also satisfy the token requirements.
  let best: string | null = null
  let bestScore = Infinity
  for (const raw of candidates) {
    const name = normalize(raw)
    const score = (name.includes('(') ? 1000 : 0) + name.length
    if (score < bestScore) {
      bestScore = score
      best = raw
    }
  }
  return best
}
