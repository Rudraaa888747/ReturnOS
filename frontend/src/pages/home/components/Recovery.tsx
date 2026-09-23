import { ArrowRight } from 'lucide-react'
import { Reveal } from '../Reveal'
import styles from '../home.module.css'

const PATHS = [
  { to: 'Restock', body: 'Sealed or like-new units back to sellable bins within hours.', value: '₹4,280 avg net' },
  { to: 'Resale', body: 'Open-box inventory listed on secondary channels, fees tracked.', value: '₹2,940 avg net' },
  { to: 'Repair', body: 'Bench work with parts and labor costed against recovery.', value: '₹3,610 avg net' },
  { to: 'Recycle', body: 'End-of-life units to material partners — documented, not dumped.', value: '₹180 avg net' },
]

export function Recovery() {
  return (
    <section className={`${styles.section} ${styles.band}`} id="recovery" aria-labelledby="recovery-h">
      <div className={styles.wrap}>
        <Reveal motion="fade">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>Recovery</p>
            <h2 id="recovery-h">Turn returned inventory into recovered value.</h2>
            <p>
              A return is not a cost entry — it is inventory in motion. Inspect,
              decide, route, and settle every unit on the path that pays best.
            </p>
          </div>
        </Reveal>
        <Reveal motion="fade">
          <ol className={styles.flow} aria-label="Recovery journey">
            {['Returned item', 'Inspection', 'Decision', 'Recovery path', 'Recovered value'].map((s, i, arr) => (
              <li key={s} className={styles.flowNode}>
                <span className={styles.flowNum} aria-hidden="true">
                  {i + 1}
                </span>
                <strong>{s}</strong>
                {i < arr.length - 1 && <ArrowRight size={15} aria-hidden="true" className={styles.flowArrow} />}
              </li>
            ))}
          </ol>
        </Reveal>
        <ul className={styles.paths}>
          {PATHS.map((p, i) => (
            <Reveal as="li" key={p.to} delay={i * 60}>
              <article className={styles.path}>
                <h3>{p.to}</h3>
                <p>{p.body}</p>
                <p className={`${styles.data} ${styles.pathValue}`}>{p.value}</p>
              </article>
            </Reveal>
          ))}
        </ul>
        <p className={styles.railNote}>Illustrative averages — your recovery economics compute from live inspections and channel costs.</p>
      </div>
    </section>
  )
}
