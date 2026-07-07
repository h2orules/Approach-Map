/**
 * Minimal RFC-4180 CSV parsing shared by the build scripts. Extracted verbatim
 * from scripts/buildStaticData.ts so buildAirportIndex.ts reuses the exact same
 * parser (no behavior drift between the two data pipelines).
 */

/** Minimal RFC-4180 CSV parser (handles quoted fields with embedded commas). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** Turn parsed CSV rows (first row = header) into keyed records. */
export function toRecords(rows: string[][]): Record<string, string>[] {
  const header = rows[0]
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    header.forEach((h, i) => (obj[h] = r[i] ?? ''))
    return obj
  })
}

/** Fetch a CSV URL and parse it into keyed records. */
export async function fetchCsv(url: string): Promise<Record<string, string>[]> {
  console.log(`Fetching ${url}`)
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status} ${resp.statusText}`)
  return toRecords(parseCsv(await resp.text()))
}
