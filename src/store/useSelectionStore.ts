import { create } from 'zustand'

export type Selection =
  | { kind: 'aircraft'; hex: string }
  | { kind: 'approach'; procedureId: string }
  | null

interface SelectionStore {
  selected: Selection
  select: (sel: NonNullable<Selection>) => void
  /** Click semantics: clicking the selected item again clears; a different item moves selection. */
  toggle: (sel: NonNullable<Selection>) => void
  clear: () => void
}

function selectionId(sel: NonNullable<Selection>): string {
  return sel.kind === 'aircraft' ? sel.hex : sel.procedureId
}

export const useSelectionStore = create<SelectionStore>((set) => ({
  selected: null,

  select: (sel) => set({ selected: sel }),

  toggle: (sel) =>
    set((s) => {
      const current = s.selected
      if (current && current.kind === sel.kind && selectionId(current) === selectionId(sel)) {
        return { selected: null }
      }
      return { selected: sel }
    }),

  clear: () => set({ selected: null }),
}))

/** The selected aircraft hex, or null when nothing / an approach is selected. */
export function selectedHexOf(sel: Selection): string | null {
  return sel?.kind === 'aircraft' ? sel.hex : null
}
