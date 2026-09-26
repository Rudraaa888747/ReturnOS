import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Reveal } from '../Reveal'
import { Curve } from './Curve'
import styles from '../home.module.css'

const VIEWS = [
  {
    key: 'customer',
    label: 'Customer',
    heading: 'Know where your return stands',
    body: 'Request in minutes, watch approval, shipment, receipt, and inspection — with the outcome explained in plain language.',
    shot: [
      ['RET-2026-0841', 'Received → inspection queued'],
      ['RET-2026-0839', 'Approved → ship the parcel'],
      ['RET-2026-0831', 'Resolved → restocked'],
    ],
  },
  {
    key: 'operations',
    label: 'Operations',
    heading: 'See what needs you first',
    body: 'Approvals, receiving, inspections, and tasks in one priority-ordered queue. Scan, act, hand off — the audit writes itself.',
    shot: [
      ['Approvals', '2 awaiting decision'],
      ['Receiving', '3 parcels at dock'],
      ['Inspections', '5 queued · 2 near SLA'],
    ],
  },
  {
    key: 'admin',
    label: 'Admin',
    heading: 'Watch recovery, not just returns',
    body: 'Disposition mix, completion rate, expected-vs-recovered, vendor settlement. The numbers that turn returns into a managed P&L line.',
    shot: [
      ['Expected recovery', '₹42,000 · sample'],
      ['Recovered', '₹31,800 · sample'],
      ['Settlement rate', '86% vendor claims'],
    ],
  },
] as const

type ViewKey = (typeof VIEWS)[number]['key']

export function Showcase() {
  const [view, setView] = useState<ViewKey>('customer')
  const active = VIEWS.find((v) => v.key === view)!
  const keys = VIEWS.map((v) => v.key)

  function onKey(e: KeyboardEvent) {
    const i = keys.indexOf(view)
    if (e.key === 'ArrowRight') setView(keys[(i + 1) % keys.length])
    if (e.key === 'ArrowLeft') setView(keys[(i - 1 + keys.length) % keys.length])
  }

  return (
    <section className={`${styles.section} ${styles.sectionFlow}`} id="product" aria-labelledby="product-h">
      <Curve tone="var(--surface-sunken)" variant="drift" />
      <div className={styles.wrap}>
        <Reveal motion="fade">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>Product</p>
            <h2 id="product-h">The screens teams actually operate.</h2>
            <p>Same return, three views. Each workspace shows exactly what its job requires.</p>
          </div>
        </Reveal>
        <Reveal>
          <div className={styles.tabs} role="tablist" aria-label="Workspace previews" onKeyDown={onKey}>
            {VIEWS.map((v) => (
              <button
                key={v.key}
                role="tab"
                aria-selected={v.key === view}
                aria-controls={`preview-${v.key}`}
                id={`tab-${v.key}`}
                tabIndex={v.key === view ? 0 : -1}
                className={`${styles.tab} ${v.key === view ? styles.tabActive : ''}`}
                onClick={() => setView(v.key)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <article
            key={view}
            className={`${styles.preview} ${styles.tabPanelSwap}`}
            role="tabpanel"
            id={`preview-${view}`}
            aria-labelledby={`tab-${view}`}
            tabIndex={0}
          >
            <div className={styles.previewText}>
              <p className={styles.previewTag}>{active.label} workspace</p>
              <h3>{active.heading}</h3>
              <p>{active.body}</p>
            </div>
            <div className={styles.previewShot} aria-label={`Illustration of the ${active.label} workspace`}>
              <div className={styles.previewBar} aria-hidden="true">
                <span className={styles.traffic}>
                  <i />
                  <i />
                  <i />
                </span>
                <span className={styles.data}>returnos / {active.key}</span>
              </div>
              <ul>
                {active.shot.map(([a, b]) => (
                  <li key={a}>
                    <span className={styles.data}>{a}</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        </Reveal>
        <p className={styles.previewNote}>
          Interface illustrations drawn from real ReturnOS workflows. Live data appears after sign-in.
        </p>
      </div>
    </section>
  )
}
