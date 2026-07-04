import { useMemo } from 'react'
import { useCifpStore } from '../services/cifpCache'
import { useProcedureStore, computeVisibility } from '../store/useProcedureStore'
import { averageCount } from '../utils/detectionHistory'
import { chooseSafeAltitudeArea } from '../geo/safeAltitude'
import { DETECTION_HISTORY_WINDOW_MS } from '../config/constants'
import type { SafeAltitudeArea } from '../types/safeAltitude'

/**
 * Resolves the single TAA/MSA area to render for each requested airport.
 * N-airport-ready by design (maps over `icaos`) even though today's only
 * caller (AppMap) passes at most one selected airport.
 */
export function useSafeAltitudes(icaos: string[]): Array<{ icao: string; area: SafeAltitudeArea }> {
  const cifpStatus = useCifpStore((s) => s.status)
  const cifpData = useCifpStore((s) => s.data)
  const userToggles = useProcedureStore((s) => s.userToggles)
  const autoVisible = useProcedureStore((s) => s.autoVisible)
  const detectionHistory = useProcedureStore((s) => s.detectionHistory)

  return useMemo(() => {
    if (cifpStatus !== 'ready') return []

    const isVisible = (procId: string) => computeVisibility(userToggles, autoVisible, procId)
    const avgCount = (procId: string) =>
      averageCount(detectionHistory[procId], Date.now(), DETECTION_HISTORY_WINDOW_MS)

    const items: Array<{ icao: string; area: SafeAltitudeArea }> = []
    for (const icao of icaos) {
      const candidates = cifpData[icao.toUpperCase()]?.safeAltitudes ?? []
      const chosen = chooseSafeAltitudeArea(candidates, isVisible, avgCount)
      if (chosen) items.push({ icao, area: chosen })
    }
    return items
  }, [icaos, cifpStatus, cifpData, userToggles, autoVisible, detectionHistory])
}
