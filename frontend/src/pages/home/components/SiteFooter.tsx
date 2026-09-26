import { Package } from 'lucide-react'
import { Curve } from './Curve'
import styles from '../home.module.css'

const COLS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Platform',
    links: [
      { label: 'Return intake', href: '#platform' },
      { label: 'Lifecycle', href: '#workflow' },
      { label: 'Tracking', href: '#track' },
      { label: 'Analytics', href: '#analytics' },
    ],
  },
  {
    title: 'Operations',
    links: [
      { label: 'Warehouse queue', href: '#operations' },
      { label: 'Decision intelligence', href: '#intelligence' },
      { label: 'Recovery paths', href: '#recovery' },
      { label: 'How it works', href: '#how' },
    ],
  },
  {
    title: 'Product',
    links: [
      { label: 'Workspaces', href: '#product' },
      { label: 'Get started', href: '/signup' },
      { label: 'Track a return', href: '#track' },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <Curve tone="var(--paper)" variant="rise" flip />
      <div className={styles.wrap}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrand}>
            <span className={styles.wordmark} aria-hidden="true">
              <span className={styles.wordmarkMark}>
                <Package size={15} strokeWidth={2.2} />
              </span>
              ReturnOS
            </span>
            <p>Reverse logistics, operated. Returns, inspection, disposition, and recovery in one system.</p>
            <p className={styles.data}>RET-2026-0841 · received → recovered</p>
          </div>
          {COLS.map((c) => (
            <nav key={c.title} aria-label={`Footer — ${c.title}`}>
              <h3>{c.title}</h3>
              <ul>
                {c.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href}>{l.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className={styles.footerBase}>
          <span>© 2026 ReturnOS · Sample data on this page is illustrative.</span>
        </div>
      </div>
    </footer>
  )
}
