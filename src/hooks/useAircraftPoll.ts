import { useEffect, useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { fetchAircraftByRadius, mergeAircraftResponses } from '../api/adsbx'
import { useAircraftStore } from '../store/useAircraftStore'
import { useAirportStore, airportKey } from '../store/useAirportStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { clusterAirports } from '../geo/clusterAirports'
import { POLL_CLUSTER_MAX_RADIUS_NM } from '../config/constants'

// Polls one covering circle per airport cluster: nearby airports (a metro area)
// coalesce into a single ADS-B query (clusterAirports), each cluster is one
// TanStack query, and the per-round results are merged (deduped by hex) into a
// single updateFromPoll call. A single airport → one cluster → one query →
// exactly today's behavior.
export function useAircraftPoll() {
  const activeAirports = useAirportStore((s) => s.activeAirports)
  const pollIntervalMs = useSettingsStore((s) => s.pollIntervalMs)
  const searchRadiusNm = useSettingsStore((s) => s.searchRadiusNm)
  const updateFromPoll = useAircraftStore((s) => s.updateFromPoll)

  const clusters = useMemo(
    () =>
      clusterAirports(
        activeAirports.map((a) => ({ key: airportKey(a), lat: a.lat, lon: a.lon })),
        searchRadiusNm,
        POLL_CLUSTER_MAX_RADIUS_NM,
      ),
    [activeAirports, searchRadiusNm],
  )

  const combined = useQueries({
    queries: clusters.map((c) => ({
      queryKey: ['aircraft', c.keys.join('+'), Math.round(c.radiusNm)],
      queryFn: () => fetchAircraftByRadius(c.lat, c.lon, c.radiusNm),
      enabled: activeAirports.length > 0,
      refetchInterval: pollIntervalMs,
      refetchIntervalInBackground: false,
      staleTime: 0,
    })),
    combine: (results) => ({
      ac: mergeAircraftResponses(results.map((r) => r.data)),
      // Max across clusters — stable within a poll round, advances when ANY
      // cluster receives fresh data, so the effect fires once per round.
      updatedAt: Math.max(0, ...results.map((r) => r.dataUpdatedAt || 0)),
      error: results.find((r) => r.error)?.error ?? null,
      isLoading: results.some((r) => r.isLoading),
    }),
  })

  useEffect(() => {
    if (combined.updatedAt > 0) {
      // Called exactly once per poll round with the FULL merged set, so no
      // cluster's aircraft age toward the stale-prune while another refetches.
      updateFromPoll(combined.ac, Date.now())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combined.updatedAt, updateFromPoll])

  return { error: combined.error, isLoading: combined.isLoading }
}
