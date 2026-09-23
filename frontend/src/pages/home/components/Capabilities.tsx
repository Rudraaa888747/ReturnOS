import { ClipboardCheck, PackageSearch, Route, Scale, ShieldCheck, Stethoscope } from 'lucide-react'
import { Reveal } from '../Reveal'
import styles from '../home.module.css'

const CAPS = [
  {
    icon: <PackageSearch size={20} aria-hidden="true" />,
    no: '01',
    title: 'Return intake',
    body: 'Centralize every request with item-level reasons, quantities, and eligibility checks — before the parcel moves. Policy rules decide in seconds; staff only touch the exceptions.',
    points: ['Order + item eligibility', 'Return window enforcement', 'Reason capture per line'],
  },
  {
    icon: <Route size={20} aria-hidden="true" />,
    no: '02',
    title: 'Intelligent routing',
    body: 'Direct each return to the right hub, dock, and workflow. Carrier shipments travel IN_TRANSIT; counter drop-offs land at RECEIVED immediately — the channel is recorded either way.',
    points: ['Shipment vs counter modes', 'Hub + dock assignment', 'Channel-stamped audit'],
  },
  {
    icon: <Stethoscope size={20} aria-hidden="true" />,
    no: '03',
    title: 'Inspection',
    body: 'Capture physical condition, packaging, accessories, and functional tests as structured evidence — not free-text chaos. What inspectors record drives every downstream decision.',
    points: ['Condition grading', 'Packaging + accessories', 'Functional test results'],
  },
  {
    icon: <Scale size={20} aria-hidden="true" />,
    no: '04',
    title: 'Disposition',
    body: 'Seven channels evaluated on net recovery — restock, refurbish, resell, vendor claim, liquidation, recycle, scrap. The best eligible value wins, with the math preserved for review.',
    points: ['7 channels, net-value ranked', 'Eligibility rules per channel', 'Override with mandatory reason'],
  },
  {
    icon: <ClipboardCheck size={20} aria-hidden="true" />,
    no: '05',
    title: 'Execution + tasks',
    body: 'Finalized dispositions become tracked executions with warehouse tasks — assigned, started, completed, or failed with reasons. No disposition ends as a sticky note.',
    points: ['Execution state machine', 'Task assignment + SLA', 'Failure reasons recorded'],
  },
  {
    icon: <ShieldCheck size={20} aria-hidden="true" />,
    no: '06',
    title: 'Audit + analytics',
    body: 'Every action lands in an immutable audit trail; every outcome feeds recovery and operations analytics. Prove what happened, then improve what happens next.',
    points: ['Chronological history per return', 'Recovery + operations aggregates', 'Health + metrics endpoints'],
  },
]

export function Capabilities() {
  return (
    <section className={styles.section} id="platform" aria-labelledby="platform-h">
      <div className={styles.wrap}>
        <Reveal motion="fade">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>Platform</p>
            <h2 id="platform-h">Everything after &ldquo;send it back&rdquo;.</h2>
            <p>
              Six capabilities, one lifecycle. Each row shows the control you
              get and the records it leaves behind.
            </p>
          </div>
        </Reveal>
        <ol className={styles.caps}>
          {CAPS.map((c, i) => (
            <Reveal as="li" key={c.no} delay={Math.min(i, 2) * 60}>
              <article className={`${styles.cap} ${i % 2 === 1 ? styles.capFlip : ''}`}>
                <div className={styles.capMedia} aria-hidden="true">
                  <span className={styles.capIcon}>{c.icon}</span>
                  <span className={styles.capNo}>{c.no}</span>
                </div>
                <div className={styles.capBody}>
                  <h3>{c.title}</h3>
                  <p>{c.body}</p>
                  <ul>
                    {c.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              </article>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}
