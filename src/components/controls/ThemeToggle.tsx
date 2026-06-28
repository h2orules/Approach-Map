import { useMapStore } from '../../store/useMapStore'
import styles from './ControlButton.module.css'

export function ThemeToggle() {
  const { theme, setTheme } = useMapStore()
  const isDark = theme === 'dark'

  return (
    <button
      className={styles.btn}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? '☀' : '☾'}
    </button>
  )
}
