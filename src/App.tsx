import { useEffect } from 'react'
import { TopBar } from './components/layout/TopBar'
import { Sidebar } from './components/layout/Sidebar'
import { AppMap } from './components/map/AppMap'
import { useMapStore } from './store/useMapStore'
import { useAiracCycle } from './hooks/useAiracCycle'
import styles from './App.module.css'

export function App() {
  const theme = useMapStore((s) => s.theme)

  useAiracCycle()

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

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
