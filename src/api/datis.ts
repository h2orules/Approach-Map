export interface AtisInfo {
  /** ATIS code letter (A–Z, or '?' if not parseable). */
  code: string
  /**
   * Per-runway approach type preferences, in the order they appear in the ATIS.
   * Keys are runway designators (e.g. "16L").
   * Values are CIFP approach name prefixes in preference order (e.g. ["I", "L"]).
   */
  runwayPrefs: Record<string, string[]>
  /** Primary in-use departure runways (e.g. ["16L"]). */
  depRunways: string[]
  /**
   * Secondary "plan and brief" departure runways — ATC asks crews to be ready
   * for these but they aren't the primary departure runway. Never overlaps
   * `depRunways` (a runway listed as both is treated as primary).
   */
  depRunwaysAdvisory: string[]
  /** Runways called out for visual approaches (not a specific CIFP type). */
  visualRunways: string[]
  raw: string
}

export interface DatisEntry {
  airport: string
  type: string   // 'combined' | 'arr' | 'dep'
  code: string   // single letter
  datis: string  // full ATIS text
}

// Map ATIS approach-type keywords → CIFP procedure name prefix.
const APPROACH_TOKEN_PREFIX: Record<string, string> = {
  ILS: 'I',
  LOC: 'L',
  RNAV: 'R',
  GPS: 'R',
  RNP: 'R',
  LDA: 'H',
  SDF: 'H',
  VOR: 'V',
  NDB: 'N',
}

/** Human-readable labels for CIFP approach type prefixes. */
export const PREFIX_READABLE: Record<string, string> = {
  I: 'ILS', L: 'LOC', R: 'RNAV', H: 'LDA', V: 'VOR', N: 'NDB',
}

// Matches any approach-type keyword; iterated in text order so "ILS OR LOC" → ['I','L'].
const APPROACH_TOKEN_RE = /\bILS\b|\bLOC\b|\bRNAV\b|\bGPS\b|\bRNP\b|\bLDA\b|\bSDF\b|\bVOR\b|\bNDB\b/g

// A runway-list clause: "RWY 16L", "RWYS 16L AND 16C", "RUNWAY 34C/34R", etc.
// Captures the runway list so individual designators can be pulled out separately.
const RUNWAY_LIST_RE = /(?:RUNWAY|RWY)S?\s+((?:\d{2}[LCR]?)(?:\s*(?:,|AND|\/)\s*\d{2}[LCR]?)*)/g

const RWY_KEYWORD = /\b(?:RUNWAY|RWY)S?\b/
const DEP_KEYWORD = /\bDEP(?:G|ART(?:ING|URE|URES))?\b/
const VISUAL_KEYWORD = /\bVISUALS?\b/
// "DEPG ACFT PLAN AND BRIEF NUMBERS FOR BOTH RWYS 34R AND 34C" is briefing
// advice, not a runway assignment — don't harvest dep runways from it.
const ADVISORY_KEYWORD = /\bPLAN\b|\bBRIEF\b/
const ARRIVAL_KEYWORD = /\bARR(?:IVAL)?S?\b|\bAPCH(?:S|ES)?\b|\bAPPROACH(?:ES)?\b/

function isValidRunway(r: string): boolean {
  const n = parseInt(r.slice(0, 2), 10)
  return n >= 1 && n <= 36
}

/** Pull individual runway designators (01–36 + optional L/C/R) out of a runway-list clause. */
function parseRunwayList(list: string): string[] {
  return [...list.matchAll(/\d{2}[LCR]?/g)]
    .map((m) => m[0])
    .filter(isValidRunway)
}

/** Extract runway designators (01–36 + optional L/C/R) anywhere in a string. */
function extractRunways(s: string): string[] {
  return [...s.matchAll(/\b(\d{2}[LCR]?)\b/g)]
    .map((m) => m[1])
    .filter(isValidRunway)
}

/** Approach-type prefixes present in text, in the order they occur (first occurrence wins ties). */
function scanApproachTypes(window: string): string[] {
  const prefixes: string[] = []
  for (const m of window.matchAll(APPROACH_TOKEN_RE)) {
    const prefix = APPROACH_TOKEN_PREFIX[m[0]]
    if (prefix && !prefixes.includes(prefix)) prefixes.push(prefix)
  }
  return prefixes
}

export function parseAtisText(text: string): AtisInfo {
  const upper = text.toUpperCase()
  const code = upper.match(/\bINFO\s+([A-Z])\b/)?.[1] ?? '?'
  const runwayPrefs: Record<string, string[]> = {}
  const visualRunways: string[] = []
  const depRunways: string[] = []
  const depRunwaysAdvisory: string[] = []

  for (const rawSentence of upper.split(/[.;]/)) {
    const s = rawSentence.trim()
    if (!s) continue

    // ── Runway-list clauses ──────────────────────────────────────────────────
    // Each runway-list keyword ("RWY"/"RUNWAY") only picks up context
    // mentioned since the previous runway-list match (or the sentence start),
    // so "ILS RWY 16L, RNAV RWY 16R" doesn't broadcast ILS onto 16R and
    // "SIMUL ARRIVALS TO RWY 34L AND DEPARTURES TO RWY 34R" doesn't mark the
    // arrival runway as a departure runway.
    let prevEnd = 0
    let depClauseSeen = false
    for (const m of s.matchAll(RUNWAY_LIST_RE)) {
      const matchIndex = m.index ?? 0
      const window = s.slice(prevEnd, matchIndex)
      const runways = parseRunwayList(m[1])
      prevEnd = matchIndex + m[0].length

      if (runways.length === 0) continue

      if (DEP_KEYWORD.test(window)) {
        depClauseSeen = true
        const bucket = ADVISORY_KEYWORD.test(window) ? depRunwaysAdvisory : depRunways
        for (const rwy of runways) {
          if (!bucket.includes(rwy)) bucket.push(rwy)
        }
        continue
      }

      // Visual and a concrete type can share one clause ("ILS AND CHARTED
      // VISUAL APPROACH RWYS 34L AND 34R") — record both, don't short-circuit.
      if (VISUAL_KEYWORD.test(window)) {
        for (const rwy of runways) {
          if (!visualRunways.includes(rwy)) visualRunways.push(rwy)
        }
      }

      const prefixes = scanApproachTypes(window)
      if (prefixes.length === 0) continue
      for (const rwy of runways) {
        if (!runwayPrefs[rwy]) runwayPrefs[rwy] = []
        for (const p of prefixes) {
          if (!runwayPrefs[rwy].includes(p)) runwayPrefs[rwy].push(p)
        }
      }
    }

    // ── Trailing-keyword departures ("RWYS 08R AND 09 FOR DEPARTURES") ──────
    // Only when no clause put the keyword before a runway list, and only for
    // sentences that are unambiguously about departures.
    if (
      !depClauseSeen &&
      DEP_KEYWORD.test(s) &&
      RWY_KEYWORD.test(s) &&
      !ADVISORY_KEYWORD.test(s) &&
      !ARRIVAL_KEYWORD.test(s) &&
      !VISUAL_KEYWORD.test(s) &&
      scanApproachTypes(s).length === 0
    ) {
      for (const rwy of extractRunways(s)) {
        if (!depRunways.includes(rwy)) depRunways.push(rwy)
      }
    }
  }

  // A runway called out as both primary and "plan and brief" is primary.
  const advisoryOnly = depRunwaysAdvisory.filter((r) => !depRunways.includes(r))

  return { code, runwayPrefs, depRunways, depRunwaysAdvisory: advisoryOnly, visualRunways, raw: text }
}

/**
 * Build a compact arrival summary string from ATIS info.
 * e.g. { "16R": ["I"], "16L": ["I"] } → "ILS 16R 16L"
 *      { "28R": ["I"], "28L": ["R"] } → "ILS 28R · RNAV 28L"
 * Visual runways (if any) are appended as a trailing "VIS 28L 28R" segment.
 */
export function arrivalSummary(info: AtisInfo): string {
  const byType: Record<string, string[]> = {}
  for (const [rwy, types] of Object.entries(info.runwayPrefs)) {
    const t = types[0]
    if (!byType[t]) byType[t] = []
    byType[t].push(rwy)
  }
  const segments = Object.entries(byType).map(
    ([t, rwys]) => `${PREFIX_READABLE[t] ?? t} ${rwys.join(' ')}`,
  )
  if (info.visualRunways.length > 0) {
    segments.push(`VIS ${info.visualRunways.join(' ')}`)
  }
  return segments.join(' · ')
}

/**
 * Combine one or more D-ATIS entries (split arr/dep, or a single combined
 * broadcast) into one AtisInfo. Approach info and code come from the arrival
 * entry when present (including any dep runways mentioned within it);
 * departure runways from a separate dep entry are unioned in.
 */
export function parseDatisEntries(entries: DatisEntry[]): AtisInfo | null {
  if (entries.length === 0) return null

  const arrEntry = entries.find((e) => e.type === 'arr')
  const depEntry = entries.find((e) => e.type === 'dep')

  if (arrEntry || depEntry) {
    const arrInfo = arrEntry ? parseAtisText(arrEntry.datis) : null
    const depInfo = depEntry ? parseAtisText(depEntry.datis) : null

    const depRunways = [...(arrInfo?.depRunways ?? [])]
    for (const rwy of depInfo?.depRunways ?? []) {
      if (!depRunways.includes(rwy)) depRunways.push(rwy)
    }
    const depRunwaysAdvisory: string[] = []
    for (const rwy of [...(arrInfo?.depRunwaysAdvisory ?? []), ...(depInfo?.depRunwaysAdvisory ?? [])]) {
      if (!depRunways.includes(rwy) && !depRunwaysAdvisory.includes(rwy)) depRunwaysAdvisory.push(rwy)
    }

    const raw = arrEntry && depEntry
      ? `${arrEntry.datis}\n\n${depEntry.datis}`
      : (arrEntry ?? depEntry)!.datis

    return {
      code: arrInfo?.code ?? depInfo?.code ?? '?',
      runwayPrefs: arrInfo?.runwayPrefs ?? {},
      depRunways,
      depRunwaysAdvisory,
      visualRunways: arrInfo?.visualRunways ?? [],
      raw,
    }
  }

  // Combined-only (or unrecognized type) — parse whichever entry is available.
  const entry = entries.find((e) => e.type === 'combined') ?? entries[0]
  return parseAtisText(entry.datis)
}

export async function fetchDatis(icao: string): Promise<AtisInfo | null> {
  try {
    // atis.info is the successor to datis.clowd.io (same API shape).
    const resp = await fetch(`/api/datis/${icao.toUpperCase()}`)
    if (!resp.ok) return null
    const data: unknown = await resp.json()
    if (!Array.isArray(data) || data.length === 0) return null

    return parseDatisEntries(data as DatisEntry[])
  } catch {
    return null
  }
}
