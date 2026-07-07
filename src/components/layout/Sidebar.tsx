import { useCallback, useEffect, useRef, useState } from 'react'
import { useAirportStore, airportKey } from '../../store/useAirportStore'
import { usePaneStore } from '../../store/usePaneStore'
import { useMapStore } from '../../store/useMapStore'
import { usePaneMode } from '../../hooks/usePaneMode'
import { SidebarHeader } from './SidebarHeader'
import { AirportList } from '../airport/AirportList'
import { SettingsPanel } from '../controls/SettingsPanel'
import styles from './Sidebar.module.css'

/** Collapsed-rail (desktop, >640px) body: stacked airport ident chips, so
 *  identity isn't lost when the sidebar shrinks to a 40px rail. */
function CollapsedRailChips({ idents }: { idents: string[] }) {
  return (
    <div className={styles.rail}>
      {idents.map((ident) => (
        <span key={ident} className={styles.railChip} title={ident}>
          {ident}
        </span>
      ))}
    </div>
  )
}

export function Sidebar() {
  const activeAirports = useAirportStore((s) => s.activeAirports)
  const mode = usePaneMode()
  const collapsed = usePaneStore((s) => s.collapsed)
  const sheetOpen = usePaneStore((s) => s.sheetOpen)
  const toggleCollapsed = usePaneStore((s) => s.toggleCollapsed)
  const toggleSheetOpen = usePaneStore((s) => s.toggleSheetOpen)
  const requestResize = useMapStore((s) => s.requestResize)

  const [sectionCollapsed, setSectionCollapsed] = useState<Record<string, boolean>>({})
  const rootRef = useRef<HTMLElement | null>(null)

  const toggleSection = useCallback((key: string) => {
    setSectionCollapsed((s) => ({ ...s, [key]: !s[key] }))
  }, [])

  const collapseAll = useCallback(() => {
    setSectionCollapsed(Object.fromEntries(activeAirports.map((a) => [airportKey(a), true])))
  }, [activeAirports])

  const expandAll = useCallback(() => {
    setSectionCollapsed({})
  }, [])

  const expanded = mode === 'push' ? !collapsed : sheetOpen
  const onToggleExpanded = mode === 'push' ? toggleCollapsed : toggleSheetOpen

  // Map resize wiring: the mapbox instance doesn't notice its container
  // reflowing on its own. The rail-collapse transition fires `transitionend`
  // on `width` (push mode only — the phone sheet animates `transform`, which
  // never resizes `.mapArea`), plus a safety timeout in case the transition
  // is skipped (reduced motion, already-settled width, etc).
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.propertyName === 'width') requestResize()
    }
    el.addEventListener('transitionend', onTransitionEnd)
    return () => el.removeEventListener('transitionend', onTransitionEnd)
  }, [requestResize])

  useEffect(() => {
    const t = setTimeout(() => requestResize(), 200)
    return () => clearTimeout(t)
  }, [collapsed, requestResize])

  const showBulkActions = expanded && activeAirports.length >= 3

  return (
    <aside
      ref={rootRef}
      className={
        mode === 'push'
          ? `${styles.sidebar} ${collapsed ? styles.collapsedRail : ''}`
          : `${styles.sheet} ${sheetOpen ? styles.sheetOpen : ''}`
      }
    >
      <SidebarHeader
        mode={mode}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
        count={activeAirports.length}
        showBulkActions={showBulkActions}
        onCollapseAll={collapseAll}
        onExpandAll={expandAll}
      />
      {expanded ? (
        <>
          <AirportList sectionCollapsed={sectionCollapsed} onToggleSection={toggleSection} />
          <SettingsPanel />
        </>
      ) : (
        mode === 'push' && <CollapsedRailChips idents={activeAirports.map(airportKey)} />
      )}
    </aside>
  )
}
