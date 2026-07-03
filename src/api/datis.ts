export interface AtisInfo {
  /** ATIS code letter (A–Z, or '?' if not parseable). */
  code: string
  /**
   * Per-runway approach type preferences, in the order they appear in the ATIS.
   * Keys are runway designators (e.g. "16L").
   * Values are CIFP approach name prefixes in preference order (e.g. ["I", "L"]).
   */
  runwayPrefs: Record<string, string[]>
  /** Departure runways mentioned in the ATIS (e.g. ["16L"]). */
  depRunways: string[]
  raw: string
}

interface DatisEntry {
  airport: string
  type: string   // 'combined' | 'arr' | 'dep'
  code: string   // single letter
  datis: string  // full ATIS text
}

// Map ATIS approach-type keywords → CIFP procedure name prefix.
// Order matters: ILS must come before LOC so "ILS OR LOC" maps to ['I','L'].
const APPROACH_TYPE_MAP: Array<{ re: RegExp; prefix: string }> = [
  { re: /\bILS\b/, prefix: 'I' },
  { re: /\bLOC\b/, prefix: 'L' },
  { re: /\bRNAV\b|\bGPS\b/, prefix: 'R' },
  { re: /\bLDA\b|\bSDF\b/, prefix: 'H' },
  { re: /\bVOR\b/, prefix: 'V' },
  { re: /\bNDB\b/, prefix: 'N' },
]

/** Human-readable labels for CIFP approach type prefixes. */
export const PREFIX_READABLE: Record<string, string> = {
  I: 'ILS', L: 'LOC', R: 'RNAV', H: 'LDA', V: 'VOR', N: 'NDB',
}

const RWY_KEYWORD = /\b(?:RUNWAY|RWY)S?\b/
const DEP_KEYWORD = /\bDEP(?:G|ARTING|ARTURE)?\b/

/** Extract runway designators (01–36 + optional L/C/R) from a string. */
function extractRunways(s: string): string[] {
  return [...s.matchAll(/\b(\d{2}[LCR]?)\b/g)]
    .map((m) => m[1])
    .filter((r) => {
      const n = parseInt(r.slice(0, 2), 10)
      return n >= 1 && n <= 36
    })
}

export function parseAtisText(text: string): AtisInfo {
  const upper = text.toUpperCase()
  const code = upper.match(/\bINFO\s+([A-Z])\b/)?.[1] ?? '?'
  const runwayPrefs: Record<string, string[]> = {}
  const depRunways: string[] = []

  for (const rawSentence of upper.split('.')) {
    const s = rawSentence.trim()

    // ── Approach-in-use sentences ────────────────────────────────────────────
    const prefixes: string[] = []
    for (const { re, prefix } of APPROACH_TYPE_MAP) {
      if (re.test(s) && !prefixes.includes(prefix)) prefixes.push(prefix)
    }
    if (prefixes.length > 0 && RWY_KEYWORD.test(s)) {
      for (const rwy of extractRunways(s)) {
        if (!runwayPrefs[rwy]) runwayPrefs[rwy] = []
        for (const p of prefixes) {
          if (!runwayPrefs[rwy].includes(p)) runwayPrefs[rwy].push(p)
        }
      }
    }

    // ── Departure-runway sentences ────────────────────────────────────────────
    if (DEP_KEYWORD.test(s) && RWY_KEYWORD.test(s)) {
      for (const rwy of extractRunways(s)) {
        if (!depRunways.includes(rwy)) depRunways.push(rwy)
      }
    }
  }

  return { code, runwayPrefs, depRunways, raw: text }
}

/**
 * Build a compact arrival summary string from ATIS info.
 * e.g. { "16R": ["I"], "16L": ["I"] } → "ILS 16R 16L"
 *      { "28R": ["I"], "28L": ["R"] } → "ILS 28R · RNAV 28L"
 */
export function arrivalSummary(info: AtisInfo): string {
  const byType: Record<string, string[]> = {}
  for (const [rwy, types] of Object.entries(info.runwayPrefs)) {
    const t = types[0]
    if (!byType[t]) byType[t] = []
    byType[t].push(rwy)
  }
  return Object.entries(byType)
    .map(([t, rwys]) => `${PREFIX_READABLE[t] ?? t} ${rwys.join(' ')}`)
    .join(' · ')
}

export async function fetchDatis(icao: string): Promise<AtisInfo | null> {
  try {
    // atis.info is the successor to datis.clowd.io (same API shape).
    const resp = await fetch(`/api/datis/${icao.toUpperCase()}`)
    if (!resp.ok) return null
    const data: unknown = await resp.json()
    if (!Array.isArray(data) || data.length === 0) return null

    const entries = data as DatisEntry[]
    // Prefer arrival ATIS (has approach info), then combined, then first available.
    const entry =
      entries.find((e) => e.type === 'arr') ??
      entries.find((e) => e.type === 'combined') ??
      entries[0]

    return parseAtisText(entry.datis)
  } catch {
    return null
  }
}
