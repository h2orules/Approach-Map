import { useEffect, useState } from 'react'
import { deriveMode, type PaneMode } from '../store/usePaneStore'

/**
 * Live viewport-driven pane mode (push vs overlay), backed by the pure
 * `deriveMode`. A resize listener keeps it in sync with rotation/window
 * resize; `deriveMode` itself stays trivially unit-testable with injected
 * widths (see src/store/__tests__/usePaneStore.test.ts).
 */
export function usePaneMode(): PaneMode {
  const [mode, setMode] = useState<PaneMode>(() => deriveMode(window.innerWidth))

  useEffect(() => {
    const onResize = () => setMode(deriveMode(window.innerWidth))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return mode
}
