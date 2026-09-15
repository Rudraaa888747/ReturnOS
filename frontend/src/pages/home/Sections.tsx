import { Link } from 'react-router-dom'
import { ArrowRight, ClipboardCheck, LineChart, UserRound } from 'lucide-react'
import { Reveal } from './Reveal'
import styles from './home.module.css'

/* ---------- workspaces ---------- */

const ROLES = [
  {
    to: '/returns',
    icon: <UserRound size={19} aria-hidden="true" />,
    title: 'Customer',
    body: 'Track returns, start a return, and see what happens next.',
    preview: 'RET-2026-0841 · Received → inspection queued',
    cta: 'Open Customer',
  },
  {
    to: '/ops',
    icon: <ClipboardCheck size={19} aria-hidden="true" />,
    title: 'Warehouse / Operations',
    body: 'Receive, inspect, and process returned items.',
    preview: 'Approvals · Receiving · Inspection · Tasks',
    cta: 'Open Operations',
  },
  {
    to: '/admin',
    icon: <LineChart size={19} aria-hidden="true" />,
    title: 'Admin',
    body: 'Monitor returns, recovery, and operational performance.',
    preview: 'Mix · Completion · Recovery gap · Claims',
    cta: 'Open Admin',
  },
]

export function Workspaces() {
  return (
    <section className={styles.section} id="workspaces" aria-labelledby="workspaces-h">
      <div className={styles.wrap}>
        <Reveal>
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>Workspaces</p>
            <h2 id="workspaces-h">Choose your workspace</h2>
            <p>One operating system, three doors. Each team gets the view its work demands — nothing it doesn’t.</p>
          </div>
        </Reveal>
        <ul className={styles.roles}>
          {ROLES.map((r) => (
            <Reveal as="li" key={r.title}>
              <article className={styles.role} style={{ height: '100%' }}>
                <span className={styles.roleIcon}>{r.icon}</span>
                <h3>{r.title}</h3>
                <p>{r.body}</p>
                <p className={styles.rolePreview} aria-label={`Typical ${r.title} view`}>
                  {r.preview}
                </p>
                <Link to={r.to} className={styles.roleCta}>
                  {r.cta} <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </article>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ---------- lifecycle ---------- */

const NODES = [
  { actor: 'Customer', title: 'Return request', body: 'Items, quantities and reasons, validated up front.' },
  { actor: 'System', title: 'Policy check', body: 'Delivery, window and eligibility rules decide instantly.' },
  { actor: 'Warehouse', title: 'Approval', body: 'Staff approve legitimate returns, reject with a reason.' },
  { actor: 'Warehouse', title: 'Receive', body: 'Carrier shipment or counter drop-off, both recorded.' },
  { actor: 'Warehouse', title: 'Inspection', body: 'Condition, packaging, accessories, function — structured.' },
  { actor: 'System', title: 'Risk + disposition', body: 'Explained score and the best-value recovery channel.' },
  { actor: 'Operations', title: 'Resolution', body: 'Restock, vendor, resale, recycle — executed and settled.' },
]

export function Lifecycle() {
  return (
    <section className={styles.section} id="workflow" aria-labelledby="workflow-h" style={{ paddingTop: 0 }}>
      <div className={styles.wrap}>
        <Reveal motion="fade">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>Workflow</p>
            <h2 id="workflow-h">One return. One connected journey.</h2>
            <p>Seven stages, three actors, zero spreadsheets. Every return moves through the same defined lifecycle.</p>
          </div>
        </Reveal>
        <Reveal motion="fade">
          <ol className={styles.rail}>
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
      </div>
    </section>
  )
}
