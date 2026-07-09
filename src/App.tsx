import { useEffect } from 'react'
import { TopBar } from './components/layout/TopBar'
import { Sidebar } from './components/layout/Sidebar'
import { AppMap } from './components/map/AppMap'
import { useMapStore } from './store/useMapStore'
import { usePaneStore } from './store/usePaneStore'
import { useAiracCycle } from './hooks/useAiracCycle'
import styles from './App.module.css'

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export function App() {
  const theme = useMapStore((s) => s.theme)

  useAiracCycle()

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Cmd/Ctrl+B toggles the desktop/tablet sidebar collapse — ignored while
  // typing in an input so it doesn't hijack a text-editing shortcut.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'b') return
      const target = e.target as HTMLElement | null
      if (target && (EDITABLE_TAGS.has(target.tagName) || target.isContentEditable)) return
      e.preventDefault()
      usePaneStore.getState().toggleCollapsed()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className={styles.app}>
      <TopBar />
      <div className={styles.body}>
        <Sidebar />
        <main className={styles.mapArea}>
          <AppMap />
        </main>
      </div>
    </div>
  )
}
