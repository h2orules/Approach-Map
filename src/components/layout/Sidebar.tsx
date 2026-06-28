import { ProcedureList } from '../procedures/ProcedureList'
import { SettingsPanel } from '../controls/SettingsPanel'
import styles from './Sidebar.module.css'

export function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <ProcedureList />
      <SettingsPanel />
    </aside>
  )
}
