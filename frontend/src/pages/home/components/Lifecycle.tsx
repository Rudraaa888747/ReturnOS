import { Reveal } from '../Reveal'
import { Curve } from './Curve'
import styles from '../home.module.css'

const NODES = [
  { actor: 'Customer', title: 'Return initiated', body: 'Items, quantities, and reasons captured and validated up front.' },
  { actor: 'System', title: 'Policy check', body: 'Delivery date, return window, and eligibility decide instantly.' },
  { actor: 'Warehouse', title: 'Approval', body: 'Staff approve legitimate returns — or reject with a recorded reason.' },
  { actor: 'Carrier', title: 'In transit', body: 'Shipment scans toward the dock, or a counter drop-off skips the road.' },
  { actor: 'Warehouse', title: 'Received', body: 'Dock, channel, and timestamp recorded — SHIPPED or COUNTER.' },
  { actor: 'Warehouse', title: 'Inspection', body: 'Condition, packaging, accessories, function — structured evidence.' },
  { actor: 'System', title: 'Risk + disposition', body: 'An explained risk score, then the best net-recovery channel.' },
  { actor: 'Operations', title: 'Recovery', body: 'Restock, refurbish, resell, vendor claim, recycle — executed, settled.' },
]

export function Lifecycle() {
  return (
    <section className={`${styles.section} ${styles.sectionFlow} ${styles.toneWash}`} id="workflow" aria-labelledby="workflow-h">
      <Curve tone="var(--surface)" variant="drift" flip />
      <div className={styles.wrap}>
        <Reveal motion="fade">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>Returns lifecycle</p>
            <h2 id="workflow-h">One return. One connected journey.</h2>
            <p>
              Eight stages, four actors, zero spreadsheets. Every return moves
              through the same defined lifecycle — and every transition is audited.
            </p>
          </div>
        </Reveal>
        <Reveal motion="fade">
          <ol className={styles.rail} aria-label="Return lifecycle stages">
            {NODES.map((n, i) => (
              <li key={n.title} className={styles.node}>
                <span className={styles.nodeNum} aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className={styles.nodeActor}>{n.actor}</span>
                <h3>{n.title}</h3>
                <p>{n.body}</p>
              </li>
            ))}
          </ol>
        </Reveal>
        <p className={styles.railNote}>
          Mirrors the real ReturnOS state machine — REQUESTED → APPROVED → IN_TRANSIT → RECEIVED →
          INSPECTION → DISPOSITION → RECOVERY. Invalid transitions are rejected, not silently allowed.
        </p>
      </div>
    </section>
  )
}
