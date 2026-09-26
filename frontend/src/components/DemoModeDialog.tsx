import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { onDemoBlocked } from '../lib/demoMode'
import styles from './ui.module.css'

/** Mount once (see main.tsx): shows a polished notice whenever the backend
 *  rejects an action with 403 DEMO_MODE. No alert() dialogs. */
export function DemoModeDialog() {
  const [open, setOpen] = useState(false)

  useEffect(() => onDemoBlocked(() => setOpen(true)), [])

  if (!open) return null

  return (
    <div
      className={styles.demoOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-mode-title"
      onClick={() => setOpen(false)}
    >
      <div className={styles.demoCard} onClick={(e) => e.stopPropagation()}>
        <span className={styles.demoIcon} aria-hidden="true">
          <Info size={22} />
        </span>
        <h2 id="demo-mode-title">Demo mode</h2>
        <p>
          This action is unavailable in the public demo. Browsing, tracking,
          and reports all work normally — only changes are disabled.
        </p>
        <button type="button" className={styles.demoClose} onClick={() => setOpen(false)} autoFocus>
          Got it
        </button>
      </div>
    </div>
  )
}
