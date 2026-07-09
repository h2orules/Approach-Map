import * as turf from '@turf/turf'

export interface ClusterInput {
  key: string
  lat: number
  lon: number
}

export interface AirportCluster {
  /** Covering-circle center. */
  lat: number
  lon: number
  /** Covering-circle radius (nm): max member distance from center + per-airport radius. */
  radiusNm: number
  /** Keys of the airports covered by this cluster, in insertion order. */
  keys: string[]
}

interface WorkingCluster {
  lat: number
  lon: number
  members: ClusterInput[]
}

function distanceNm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  return turf.distance(turf.point([aLon, aLat]), turf.point([bLon, bLat]), {
    units: 'nauticalmiles',
  })
}

/** Centroid + covering radius (max member distance from centroid) for a member set. */
function coverOf(members: ClusterInput[]): { lat: number; lon: number; coverNm: number } {
  let sumLat = 0
  let sumLon = 0
  for (const m of members) {
    sumLat += m.lat
    sumLon += m.lon
  }
  const lat = sumLat / members.length
  const lon = sumLon / members.length
  let coverNm = 0
  for (const m of members) {
    const d = distanceNm(lat, lon, m.lat, m.lon)
    if (d > coverNm) coverNm = d
  }
  return { lat, lon, coverNm }
}

/**
 * Greedily cluster airports into covering circles so that nearby airports (a
 * metro area) coalesce into a single ADS-B poll. Each cluster's circle is the
 * centroid of its members plus `perAirportRadiusNm` (so every member's own
 * search radius is fully covered); a candidate joins a cluster only if the
 * resulting circle stays within `maxRadiusNm` (the ADSBX 250 nm query clamp).
 *
 * Deterministic: input is sorted by (lat, lon, key) first, so the result does
 * not depend on the caller's ordering. A single-member cluster is exactly
 * today's behavior — center = that airport, radius = `perAirportRadiusNm`.
 */
export function clusterAirports(
  airports: ClusterInput[],
  perAirportRadiusNm: number,
  maxRadiusNm: number,
): AirportCluster[] {
  const sorted = [...airports].sort(
    (a, b) => a.lat - b.lat || a.lon - b.lon || a.key.localeCompare(b.key),
  )

  const clusters: WorkingCluster[] = []

  for (const ap of sorted) {
    let placed = false
    for (const cluster of clusters) {
      const members = [...cluster.members, ap]
      // Centroid + max-member-distance covering circle. (The centroid is the
      // arithmetic mean of all members, so it's already a fixed point — no
      // iterative refinement is needed for this formulation.)
      const cover = coverOf(members)
      const radiusNm = cover.coverNm + perAirportRadiusNm
      if (radiusNm <= maxRadiusNm) {
        cluster.members = members
        cluster.lat = cover.lat
        cluster.lon = cover.lon
        placed = true
        break
      }
    }
    if (!placed) {
      clusters.push({ lat: ap.lat, lon: ap.lon, members: [ap] })
    }
  }

  return clusters.map((c) => {
    const cover = coverOf(c.members)
    return {
      lat: cover.lat,
      lon: cover.lon,
      radiusNm: cover.coverNm + perAirportRadiusNm,
      keys: c.members.map((m) => m.key),
    }
  })
}
