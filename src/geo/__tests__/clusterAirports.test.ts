import { describe, it, expect } from 'vitest'
import * as turf from '@turf/turf'
import { clusterAirports, type ClusterInput } from '../clusterAirports'
import { ADSBX_SEARCH_RADIUS_NM, POLL_CLUSTER_MAX_RADIUS_NM } from '../../config/constants'

const KJFK: ClusterInput = { key: 'KJFK', lat: 40.6398, lon: -73.7789 }
const KLGA: ClusterInput = { key: 'KLGA', lat: 40.7772, lon: -73.8726 }
const KEWR: ClusterInput = { key: 'KEWR', lat: 40.6925, lon: -74.1687 }
const KSEA: ClusterInput = { key: 'KSEA', lat: 47.4489, lon: -122.3094 }
const KBFI: ClusterInput = { key: 'KBFI', lat: 47.53, lon: -122.302 }

function distNm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  return turf.distance(turf.point([aLon, aLat]), turf.point([bLon, bLat]), {
    units: 'nauticalmiles',
  })
}

/** Set of keys per cluster, for order-independent comparison. */
function membership(clusters: ReturnType<typeof clusterAirports>): string[][] {
  return clusters.map((c) => [...c.keys].sort()).sort((a, b) => a[0].localeCompare(b[0]))
}

describe('clusterAirports', () => {
  it('coalesces the NYC metro (KJFK+KLGA+KEWR) into a single cluster at the 50 nm search radius', () => {
    const clusters = clusterAirports([KJFK, KLGA, KEWR], ADSBX_SEARCH_RADIUS_NM, POLL_CLUSTER_MAX_RADIUS_NM)
    expect(clusters).toHaveLength(1)
    expect([...clusters[0].keys].sort()).toEqual(['KEWR', 'KJFK', 'KLGA'])
  })

  it("the metro cluster's circle actually covers every member's own search radius", () => {
    const [c] = clusterAirports([KJFK, KLGA, KEWR], ADSBX_SEARCH_RADIUS_NM, POLL_CLUSTER_MAX_RADIUS_NM)
    for (const ap of [KJFK, KLGA, KEWR]) {
      const d = distNm(c.lat, c.lon, ap.lat, ap.lon)
      // Every member's 50 nm disc is inside the cluster circle.
      expect(d + ADSBX_SEARCH_RADIUS_NM).toBeLessThanOrEqual(c.radiusNm + 1e-6)
    }
  })

  it('keeps far-apart airports (KSEA + KJFK) in two clusters', () => {
    const clusters = clusterAirports([KSEA, KJFK], ADSBX_SEARCH_RADIUS_NM, POLL_CLUSTER_MAX_RADIUS_NM)
    expect(clusters).toHaveLength(2)
    expect(membership(clusters)).toEqual([['KJFK'], ['KSEA']])
  })

  it('merges a same-metro pair (KSEA + KBFI, ~5 nm apart) into one cluster', () => {
    const clusters = clusterAirports([KSEA, KBFI], ADSBX_SEARCH_RADIUS_NM, POLL_CLUSTER_MAX_RADIUS_NM)
    expect(clusters).toHaveLength(1)
    expect([...clusters[0].keys].sort()).toEqual(['KBFI', 'KSEA'])
  })

  it('a single airport is exactly today’s behavior: one cluster centered on it, radius = perAirportRadiusNm', () => {
    const clusters = clusterAirports([KSEA], ADSBX_SEARCH_RADIUS_NM, POLL_CLUSTER_MAX_RADIUS_NM)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].keys).toEqual(['KSEA'])
    expect(clusters[0].lat).toBeCloseTo(KSEA.lat, 10)
    expect(clusters[0].lon).toBeCloseTo(KSEA.lon, 10)
    expect(clusters[0].radiusNm).toBeCloseTo(ADSBX_SEARCH_RADIUS_NM, 10)
  })

  it('never produces a cluster whose circle exceeds the max radius clamp, even for a wide spread', () => {
    // A chain of airports 1° of latitude apart (~60 nm each) spanning ~10°:
    // a naive single covering circle would be far larger than 250 nm.
    const spread: ClusterInput[] = []
    for (let i = 0; i < 11; i++) {
      spread.push({ key: `A${i}`, lat: 30 + i, lon: -100 })
    }
    const clusters = clusterAirports(spread, ADSBX_SEARCH_RADIUS_NM, POLL_CLUSTER_MAX_RADIUS_NM)
    expect(clusters.length).toBeGreaterThan(1)
    for (const c of clusters) {
      expect(c.radiusNm).toBeLessThanOrEqual(POLL_CLUSTER_MAX_RADIUS_NM + 1e-9)
    }
    // Every airport is covered by exactly one cluster (partition of the input).
    const covered = clusters.flatMap((c) => c.keys).sort()
    expect(covered).toEqual(spread.map((a) => a.key).sort())
  })

  it('is deterministic: shuffled input yields identical cluster membership', () => {
    const airports = [KJFK, KLGA, KEWR, KSEA, KBFI]
    const orderA = clusterAirports(airports, ADSBX_SEARCH_RADIUS_NM, POLL_CLUSTER_MAX_RADIUS_NM)
    const shuffled = [KBFI, KEWR, KSEA, KJFK, KLGA]
    const orderB = clusterAirports(shuffled, ADSBX_SEARCH_RADIUS_NM, POLL_CLUSTER_MAX_RADIUS_NM)
    expect(membership(orderB)).toEqual(membership(orderA))
    // NYC trio in one cluster, Seattle pair in another (membership() sorts
    // clusters by their first key, so KBFI... precedes KEWR...).
    expect(membership(orderA)).toEqual([['KBFI', 'KSEA'], ['KEWR', 'KJFK', 'KLGA']])
  })

  it('handles the empty input', () => {
    expect(clusterAirports([], ADSBX_SEARCH_RADIUS_NM, POLL_CLUSTER_MAX_RADIUS_NM)).toEqual([])
  })
})
