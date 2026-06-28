import { useEffect } from 'react'
import { getCifpData, setupVisibilityRefresh } from '../services/cifpCache'

export function useAiracCycle() {
  useEffect(() => {
    void getCifpData()
    const cleanup = setupVisibilityRefresh()
    return cleanup
  }, [])
}
