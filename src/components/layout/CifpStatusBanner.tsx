import { useCifpStore } from '../../services/cifpCache'
import styles from './CifpStatusBanner.module.css'

export function CifpStatusBanner() {
  const status = useCifpStore((s) => s.status)
  const progress = useCifpStore((s) => s.progress)
  const message = useCifpStore((s) => s.progressMessage)
  const error = useCifpStore((s) => s.error)

  if (status === 'ready' || status === 'idle') return null

  return (
    <div className={`${styles.banner} ${status === 'error' ? styles.error : ''}`}>
      {status !== 'error' && (
        <div className={styles.bar} style={{ width: `${progress}%` }} />
      )}
      <span className={styles.text}>{status === 'error' ? error : message}</span>
    </div>
  )
}
