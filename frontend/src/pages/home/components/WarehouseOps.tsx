import { ArrowRight } from 'lucide-react'
import { Reveal } from '../Reveal'
import styles from '../home.module.css'

const ROWS = [
  { id: 'RET-2026-0841', sku: 'SKU-HEADPH-001', cond: 'Open box', pri: 'High', priTone: 'bad', action: 'Inspect', sla: '2h left' },
  { id: 'RET-2026-0839', sku: 'SKU-JKT-918', cond: 'Sealed', pri: 'Medium', priTone: 'warn', action: 'Restock', sla: '6h left' },
  { id: 'RET-2026-0836', sku: 'SKU-SHOE-042', cond: 'Damaged', pri: 'High', priTone: 'bad', action: 'Vendor claim', sla: '1h left' },
  { id: 'RET-2026-0831', sku: 'SKU-LAMP-207', cond: 'Good', pri: 'Low', priTone: 'ok', action: 'Resell', sla: '1d left' },
] as const

export function WarehouseOps() {
  return (
    <section className={`${styles.section} ${styles.ops}`} id="operations" aria-labelledby="ops-h">
      <div className={styles.wrap}>
        <div className={styles.opsGrid}>
          <Reveal motion="fade">
            <div>
              <p className={`${styles.kicker} ${styles.kickerLight}`}>Warehouse operations</p>
              <h2 id="ops-h" className={styles.opsTitle}>
                The floor view, in priority order.
              </h2>
              <p className={styles.opsLede}>
                Inbound returns land in a single queue with condition, priority,
                bin, and the next physical action. Operators work top-down;
                supervisors see SLA pressure before it becomes a breach.
              </p>
              <ul className={styles.opsList}>
                <li>
                  <strong>Inbound triage</strong> — shipment vs counter, docked and timestamped.
                </li>
                <li>
                  <strong>Inspection queue</strong> — condition-first ordering, evidence captured inline.
                </li>
                <li>
                  <strong>Task ownership</strong> — assigned, started, completed. Nothing anonymous.
                </li>
              </ul>
              <a href="#product" className={styles.opsCta}>
                See the product workspaces <ArrowRight size={15} aria-hidden="true" />
              </a>
            </div>
          </Reveal>
          <Reveal delay={90}>
            <div className={styles.opsConsole} role="img" aria-label="Illustration of the warehouse inbound returns queue with four prioritized returns.">
              <div className={styles.opsBar} aria-hidden="true">
                <span>INBOUND RETURNS · AMD-02</span>
                <span className={styles.data}>4 open · 2 near SLA</span>
              </div>
              <ul className={styles.opsRows} aria-hidden="true">
                {ROWS.map((r) => (
                  <li key={r.id}>
                    <div className={styles.opsRowTop}>
                      <span className={`${styles.data} ${styles.opsId}`}>{r.id}</span>
                      <span className={`${styles.stamp} ${styles[`stamp${r.priTone[0].toUpperCase()}${r.priTone.slice(1)}` as 'stampBad' | 'stampWarn' | 'stampOk']}`}>
                        {r.pri}
                      </span>
                    </div>
                    <div className={styles.opsRowMeta}>
                      <span className={styles.data}>{r.sku}</span>
                      <span>{r.cond}</span>
                      <span>SLA {r.sla}</span>
                    </div>
                    <div className={styles.opsRowAction}>
                      <span>Action: {r.action}</span>
                      <span className={styles.opsScan}>scan ▸</span>
                    </div>
                  </li>
                ))}
              </ul>
              <p className={styles.opsFoot} aria-hidden="true">
                Sample queue — live tasks appear after sign-in.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
