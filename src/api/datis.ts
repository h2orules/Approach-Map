export interface AtisInfo {
  /** ATIS code letter (A–Z, or '?' if not parseable). */
  code: string
  /**
   * Per-runway approach type preferences, in the order they appear in the ATIS.
   * Keys are runway designators (e.g. "16L").
   * Values are CIFP approach name prefixes in preference order (e.g. ["I", "L"]).
   */
  runwayPrefs: Record<string, string[]>
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

const RWY_KEYWORD = /\b(?:RUNWAY|RWY)S?\b/

export function parseAtisText(text: string): AtisInfo {
  const upper = text.toUpperCase()
  const code = upper.match(/\bINFO\s+([A-Z])\b/)?.[1] ?? '?'
  const runwayPrefs: Record<string, string[]> = {}

  // Sentence-level parse: split on periods, examine each sentence for
  // approach type keywords + RWY/RUNWAY references.
  for (const rawSentence of upper.split('.')) {
    const s = rawSentence.trim()

    // Collect approach types mentioned in this sentence.
    const prefixes: string[] = []
    for (const { re, prefix } of APPROACH_TYPE_MAP) {
      if (re.test(s) && !prefixes.includes(prefix)) prefixes.push(prefix)
    }
    if (prefixes.length === 0) continue

    // Only process sentences that also mention a runway.
    if (!RWY_KEYWORD.test(s)) continue

    // Extract all runway designators (01–36, optional L/C/R suffix) from this
    // sentence.  Using word-boundary anchors prevents partial matches inside
    // larger numbers (e.g. "BKN070", "A3007", "19006KT").
    const rwys = [...s.matchAll(/\b(\d{2}[LCR]?)\b/g)]
      .map((m) => m[1])
      .filter((r) => {
        const n = parseInt(r.slice(0, 2), 10)
        return n >= 1 && n <= 36
      })

    for (const rwy of rwys) {
      if (!runwayPrefs[rwy]) runwayPrefs[rwy] = []
      for (const p of prefixes) {
        if (!runwayPrefs[rwy].includes(p)) runwayPrefs[rwy].push(p)
      }
    }
  }

  return { code, runwayPrefs, raw: text }
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
