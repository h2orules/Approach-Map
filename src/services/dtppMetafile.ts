import { create } from 'zustand'
import { dtppCycle } from '../utils/dtppCycle'
import { matchChartName } from '../utils/approachChartName'

const DB_NAME = 'approach-map-dtpp'
const DB_VERSION = 1
const STORE_NAME = 'dtpp'

export interface DtppChart {
  chartName: string
  amdt: string
  amdtDate: string
}

export type DtppStatus = 'idle' | 'loading' | 'ready' | 'error'

interface CachedRecord {
  cycle: string
  byIcao: Record<string, DtppChart[]>
}

interface DtppStore {
  status: DtppStatus
  cycle: string | null
  byIcao: Record<string, DtppChart[]>

  setLoading: () => void
  setReady: (cycle: string, byIcao: Record<string, DtppChart[]>) => void
  setError: () => void
}

export const useDtppStore = create<DtppStore>((set) => ({
  status: 'idle',
  cycle: null,
  byIcao: {},

  setLoading: () => set({ status: 'loading' }),
  setReady: (cycle, byIcao) => set({ status: 'ready', cycle, byIcao }),
  setError: () => set({ status: 'error' }),
}))

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function dbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

async function dbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).put(value, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// Pure extractor over a parsed d-TPP metafile Document. Schema (per FAA
// digital-tpp XML, as documented for this workstream — aeronav.faa.gov is
// blocked from this environment's network egress, so every field access
// below is optional-chained defensively rather than assumed):
//
//   <digital_tpp cycle="2606" ...>
//     <state_code ID="WA">
//       <city_name ID="SEATTLE">
//         <airport_name ID="SEATTLE-TACOMA INTL" icao_ident="KSEA">
//           (or a nested <icao_ident>KSEA</icao_ident> child — both are
//           supported since which form the live schema uses is unverified)
//           <record>
//             <chartseq>10200</chartseq>
//             <chart_code>IAP</chart_code>
//             <chart_name>ILS OR LOC RWY 16C</chart_name>
//             <amdt_num>12</amdt_num>
//             <amdt_date>03/06/25</amdt_date>
//           </record>
//           ... (other chart_code values: STAR, DP, MIN, APD, etc. — skipped)
//         </airport_name>
//       </city_name>
//     </state_code>
//     ...
//   </digital_tpp>
//
// Only chart_code === 'IAP' (approach plate) records are kept, since that's
// all matchChartName / getAmdtFor need.
export function reduceMetafile(doc: Document): Record<string, DtppChart[]> {
  const byIcao: Record<string, DtppChart[]> = {}

  const airportEls = Array.from(doc.getElementsByTagName('airport_name'))
  for (const airportEl of airportEls) {
    const icao = (
      airportEl.getAttribute('icao_ident') ??
      airportEl.getElementsByTagName('icao_ident')[0]?.textContent ??
      ''
    )
      .trim()
      .toUpperCase()
    if (!icao) continue

    const records = Array.from(airportEl.getElementsByTagName('record'))
    for (const record of records) {
      const chartCode = record.getElementsByTagName('chart_code')[0]?.textContent?.trim()
      if (chartCode !== 'IAP') continue

      const chartName = record.getElementsByTagName('chart_name')[0]?.textContent?.trim() ?? ''
      if (!chartName) continue

      const amdt = record.getElementsByTagName('amdt_num')[0]?.textContent?.trim() ?? ''
      const amdtDate = record.getElementsByTagName('amdt_date')[0]?.textContent?.trim() ?? ''

      if (!byIcao[icao]) byIcao[icao] = []
      byIcao[icao].push({ chartName, amdt, amdtDate })
    }
  }

  return byIcao
}

let inflightPromise: Promise<void> | null = null

export async function ensureDtppLoaded(effectiveDate: Date): Promise<void> {
  const cycle = dtppCycle(effectiveDate)
  const state = useDtppStore.getState()

  if (state.status === 'loading') {
    await (inflightPromise ?? Promise.resolve())
    return
  }
  if (state.status === 'ready' && state.cycle === cycle) return

  inflightPromise = loadCycle(cycle)
  try {
    await inflightPromise
  } finally {
    inflightPromise = null
  }
}

async function loadCycle(cycle: string): Promise<void> {
  useDtppStore.getState().setLoading()

  try {
    const db = await openDb()
    const cached = await dbGet<CachedRecord>(db, cycle)
    if (cached) {
      useDtppStore.getState().setReady(cycle, cached.byIcao)
      return
    }

    const resp = await fetch(`/api/dtpp/${cycle}/xml_data/d-TPP_Metafile.xml`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status} downloading d-TPP metafile`)

    const text = await resp.text()
    // One-time ~10-15MB XML parse on the main thread per 28-day AIRAC cycle.
    // Unlike the CIFP parse (src/services/cifpCache.ts), this isn't worker-
    // offloaded — it runs far less often per session and the payload is
    // smaller, so the one-time jank isn't worth a second worker.
    const doc = new DOMParser().parseFromString(text, 'text/xml')
    const byIcao = reduceMetafile(doc)

    useDtppStore.getState().setReady(cycle, byIcao)
    await dbPut(db, cycle, { cycle, byIcao } satisfies CachedRecord)
  } catch (err) {
    // Non-fatal: callers render "Amdt —" when no data is available.
    console.error('Failed to load d-TPP metafile:', err)
    useDtppStore.getState().setError()
  }
}

export function getAmdtFor(
  icao: string,
  proc: { name: string; runways: string[] },
): { amdt: string; amdtDate: string } | null {
  const { byIcao } = useDtppStore.getState()
  const charts = byIcao[icao.toUpperCase()] ?? []
  if (charts.length === 0) return null

  const match = matchChartName(proc, charts.map((c) => c.chartName))
  if (!match) return null

  const chart = charts.find((c) => c.chartName === match)
  return chart ? { amdt: chart.amdt, amdtDate: chart.amdtDate } : null
}
