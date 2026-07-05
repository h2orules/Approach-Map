import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson'
import type { AirspaceSector, AirspaceClass } from '../types/airspace'
import { airspaceStyleFor } from '../utils/airspaceFormat'

// FAA Aeronautical Information Services "Class_Airspace" ArcGIS FeatureServer,
// reached through the /api/faa-airspace dev proxy (see vite.config.ts). The
// proxy target is the layer-0 endpoint, so callers hit `/api/faa-airspace/query`.
const QUERY_URL = '/api/faa-airspace/query'

// Only the attributes the overlay renders/labels — keeps the (already large)
// geometry payload from also carrying ~30 unused fields per feature.
const OUT_FIELDS = 'NAME,CLASS,LOCAL_TYPE,LOWER_VAL,LOWER_CODE,UPPER_VAL,UPPER_CODE'

export interface AirspaceBBox {
  west: number
  south: number
  east: number
  north: number
}

interface RawProps {
  NAME?: string | null
  CLASS?: string | null
  LOCAL_TYPE?: string | null
  LOWER_VAL?: number | null
  LOWER_CODE?: string | null
  UPPER_VAL?: number | null
  UPPER_CODE?: string | null
}

function isDrawnClass(c: string | null | undefined): c is AirspaceClass {
  return c === 'B' || c === 'C' || c === 'D' || c === 'E'
}

function toSector(feature: Feature): AirspaceSector | null {
  const p = (feature.properties ?? {}) as RawProps
  const cls = p.CLASS
  if (!isDrawnClass(cls)) return null

  const geom = feature.geometry
  if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) return null

  const lowerVal = p.LOWER_VAL ?? 0
  return {
    name: p.NAME ?? '',
    airspaceClass: cls,
    localType: p.LOCAL_TYPE ?? `CLASS_${cls}`,
    style: airspaceStyleFor(cls, lowerVal),
    lowerVal,
    lowerCode: p.LOWER_CODE ?? '',
    upperVal: p.UPPER_VAL ?? 0,
    upperCode: p.UPPER_CODE ?? '',
    geometry: geom as Polygon | MultiPolygon,
  }
}

/**
 * Fetches Class B/C/D/E airspace polygons intersecting `bbox` (WGS84) from the
 * FAA FeatureServer as GeoJSON, parsed into AirspaceSectors. Throws on network
 * or HTTP error; returns [] when the area simply has no charted airspace.
 */
export async function fetchAirspace(bbox: AirspaceBBox): Promise<AirspaceSector[]> {
  const params = new URLSearchParams({
    where: "CLASS IN ('B','C','D','E')",
    geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: OUT_FIELDS,
    outSR: '4326',
    returnGeometry: 'true',
    f: 'geojson',
  })

  const resp = await fetch(`${QUERY_URL}?${params.toString()}`)
  if (!resp.ok) throw new Error(`airspace query failed: HTTP ${resp.status}`)
  const fc = (await resp.json()) as FeatureCollection & { error?: unknown }
  // ArcGIS reports query errors as a 200 with an { error } body, not an HTTP
  // status — surface those instead of silently returning nothing.
  if (fc.error) throw new Error(`airspace query error: ${JSON.stringify(fc.error)}`)
  if (!Array.isArray(fc.features)) return []

  const sectors: AirspaceSector[] = []
  for (const f of fc.features) {
    const s = toSector(f)
    if (s) sectors.push(s)
  }
  return sectors
}
