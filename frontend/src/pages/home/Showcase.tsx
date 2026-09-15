import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Package } from 'lucide-react'
import { Reveal } from './Reveal'
import { Timeline } from '../../components/visuals'
import { Bars } from '../../components/visuals'
import styles from './home.module.css'

/** Static interface illustrations drawn from real ReturnOS screens. */

function CustomerShot() {
  return (
    <div className={styles.previewShot} aria-label="Illustration of the customer return timeline">
      <strong className="data">RET-2026-0841</strong>
      <div style={{ marginTop: 8 }}>
        <Timeline
          steps={[
            { key: 'r', title: 'Requested', detail: '12 Sep', state: 'done' },
            { key: 'a', title: 'Approved', detail: '13 Sep', state: 'done' },
            { key: 't', title: 'In transit', detail: 'With carrier', state: 'done' },
            { key: 'v', title: 'Received', detail: 'Arrived 15 Sep', state: 'now' },
            { key: 'i', title: 'Inspection', state: 'todo' },
            { key: 'o', title: 'Outcome', state: 'todo' },
          ]}
        />
      </div>
    </div>
  )
}

function OpsShot() {
  const rows: [string, string, string][] = [
    ['RET-2026-0841', 'Received', 'Inspect'],
    ['RET-2026-0839', 'Requested', 'Decide'],
    ['RET-2026-0836', 'In transit', 'Receive'],
  ]
  return (
    <div className={styles.previewShot} aria-label="Illustration of the warehouse work queue">
      <strong>Work queue</strong>
      <ul>
        {rows.map(([id, status, action]) => (
          <li key={id}>
            <span className="data">{id}</span>
            <span>
              {status} · <u>{action}</u>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AdminShot() {
  return (
    <div className={styles.previewShot} aria-label="Illustration of recovery analytics">
      <strong>Expected vs recovered</strong>
      <div style={{ marginTop: 8 }}>
        <Bars
          format={(v) => `₹${v.toLocaleString('en-IN')}`}
          rows={[
            { key: 'e', label: 'Expected', value: 42000, color: 'var(--ink-3)' },
            { key: 'a', label: 'Recovered', value: 31800, color: 'var(--brand)' },
          ]}
        />
      </div>
    </div>
  )
}

const VIEWS = [
  { key: 'customer', label: 'Customer', heading: 'Know where your return stands' },
  { key: 'operations', label: 'Operations', heading: 'See what needs you first' },
  { key: 'admin', label: 'Admin', heading: 'Watch recovery, not just returns' },
] as const

type ViewKey = (typeof VIEWS)[number]['key']

export function Showcase() {
  const [view, setView] = useState<ViewKey>('customer')
  const active = VIEWS.find((v) => v.key === view)!

  return (
    <section className={styles.section} id="product" aria-labelledby="product-h" style={{ paddingTop: 0 }}>
      <div className={styles.wrap}>
        <Reveal motion="fade">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>Product</p>
            <h2 id="product-h">The screens teams actually use</h2>
            <p>Same return, three views. Each workspace shows exactly what its job requires.</p>
          </div>
        </Reveal>
        <Reveal>
          <div className={styles.tabs} role="tablist" aria-label="Workspace previews">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                role="tab"
                aria-selected={v.key === view}
                aria-controls={`preview-${v.key}`}
                id={`tab-${v.key}`}
                className={`${styles.tab} ${v.key === view ? styles.tabActive : ''}`}
                onClick={() => setView(v.key)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <article
            key={view}
            className={`${styles.preview} ${styles.tabPanel} ${styles.tabPanelSwap}`}
            role="tabpanel"
            id={`preview-${view}`}
            aria-labelledby={`tab-${view}`}
          >
            <p className={styles.previewTag}>{active.label}</p>
            <h3>{active.heading}</h3>
            {view === 'customer' && <CustomerShot />}
            {view === 'operations' && <OpsShot />}
            {view === 'admin' && <AdminShot />}
          </article>
        </Reveal>
        <p className={styles.previewNote}>
          Interface illustrations drawn from real ReturnOS workflows. Live data appears after sign-in.
        </p>
      </div>
    </section>
  )
}

const PRINCIPLES: [string, string, string][] = [
  ['01', 'Connected workflow', 'One return moves through a defined operational lifecycle.'],
  ['02', 'Operational clarity', 'Every team sees what needs attention next.'],
  ['03', 'Recovery visibility', 'Understand where returned inventory goes and what value is recovered.'],
  ['04', 'Auditable operations', 'Structured actions, states, and history across the return lifecycle.'],
]

export function Principles() {
  return (
    <section className={styles.section} aria-labelledby="why-h" style={{ paddingTop: 0 }}>
      <div className={styles.wrap}>
        <Reveal motion="fade">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>Why ReturnOS</p>
            <h2 id="why-h">Built like operations actually work</h2>
          </div>
        </Reveal>
        <ol className={styles.principles}>
          {PRINCIPLES.map(([n, title, body]) => (
            <Reveal as="li" key={n}>
              <span className={styles.principleNum} aria-hidden="true">
                {n}
              </span>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}

export function FinalCta() {
  return (
    <section aria-labelledby="cta-h" style={{ paddingBottom: 'var(--sp-4)' }}>
      <div className={styles.wrap}>
        <Reveal>
          <div className={styles.band}>
            <h2 id="cta-h">Every return has an outcome.</h2>
            <p>ReturnOS makes the journey visible from request to resolution.</p>
            <div className={styles.bandCtas}>
              <Link to="/register" className={styles.bandPrimary}>
                Explore ReturnOS
              </Link>
              <Link to="/login" className={styles.bandQuiet}>
                Sign in
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

export function Footer() {
  return (
    <div className={styles.wrap}>
      <footer className={styles.footer}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600, color: 'var(--ink)' }}>
          <Package size={15} aria-hidden="true" /> ReturnOS
        </span>
        <span>Reverse logistics, operated.</span>
        <nav aria-label="Footer">
          <Link to="/login">Sign in</Link>
          <a href="#workflow">Workflow</a>
          <a href="#workspaces">Workspaces</a>
        </nav>
      </footer>
    </div>
  )
}
