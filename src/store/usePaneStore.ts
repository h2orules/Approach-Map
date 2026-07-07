import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type PaneMode = 'push' | 'overlay'

/** Matches the app's existing phone breakpoint (App.module.css / Sidebar.module.css). */
export const PANE_OVERLAY_BREAKPOINT_PX = 640

/**
 * Pure so it's unit-testable with injected widths, with no DOM/window
 * dependency. `push` = desktop/tablet (sidebar reflows the map when it
 * collapses); `overlay` = phone (sidebar becomes a fixed bottom sheet and the
 * map canvas never resizes).
 */
export function deriveMode(widthPx: number): PaneMode {
  return widthPx > PANE_OVERLAY_BREAKPOINT_PX ? 'push' : 'overlay'
}

interface PaneStore {
  /** Desktop/tablet: sidebar rail-collapsed. Persisted. */
  collapsed: boolean
  /** Phone: bottom sheet expanded (~70vh) vs peeking (44px handle). Not persisted. */
  sheetOpen: boolean
  /** Dismissal of the "many airports active" clutter hint. Not persisted (re-shows next session). */
  clutterHintDismissed: boolean

  toggleCollapsed: () => void
  setCollapsed: (collapsed: boolean) => void
  setSheetOpen: (open: boolean) => void
  toggleSheetOpen: () => void
  dismissClutterHint: () => void
}

export const usePaneStore = create<PaneStore>()(
  persist(
    (set) => ({
      collapsed: false,
      sheetOpen: false,
      clutterHintDismissed: false,

      toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
      setCollapsed: (collapsed) => set({ collapsed }),
      setSheetOpen: (open) => set({ sheetOpen: open }),
      toggleSheetOpen: () => set((s) => ({ sheetOpen: !s.sheetOpen })),
      dismissClutterHint: () => set({ clutterHintDismissed: true }),
    }),
    {
      name: 'approach-map-pane',
      version: 1,
      // Only the desktop collapse state persists; sheetOpen and the clutter
      // hint dismissal are session-local (bottom sheet always starts peeking,
      // and the clutter hint re-earns its dismissal each session).
      partialize: (s) => ({ collapsed: s.collapsed }),
    },
  ),
)
