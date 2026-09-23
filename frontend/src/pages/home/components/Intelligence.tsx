import { Reveal } from '../Reveal'
import styles from '../home.module.css'

const CANDIDATES = [
  { ch: 'Restock', net: '₹4,280', tone: 'ok', note: 'Sealed · like new · bin A-22', eligible: true, pick: true },
  { ch: 'Refurbish', net: '₹3,610', tone: 'info', note: 'Light cleaning · 2-day bench', eligible: true, pick: false },
  { ch: 'Resell', net: '₹2,940', tone: 'info', note: 'Open-box channel · fees applied', eligible: true, pick: false },
  { ch: 'Vendor claim', net: '—', tone: 'neutral', note: 'Not eligible · no defect evidence', eligible: false, pick: false },
  { ch: 'Recycle', net: '₹180', tone: 'neutral', note: 'Fallback · material value only', eligible: true, pick: false },
]

const SIGNALS = [
  { name: 'Return-risk score', body: 'Rule-based 0–100 with per-rule explanations. An attention signal for operators — never a fraud accusation against the customer.' },
  { name: 'Recovery optimization', body: 'Every eligible channel priced with recovery, processing, shipping, and refurbishment costs. Best net value is recommended, not guessed.' },
  { name: 'Workload prioritization', body: 'SLA pressure, condition, and value-at-stake order the queue, so the returns that matter most get hands first.' },
]

export function Intelligence() {
  return (
    <section className={styles.section} id="intelligence" aria-labelledby="intel-h">
      <div className={styles.wrap}>
        <Reveal motion="fade">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>Decision intelligence</p>
            <h2 id="intel-h">Recommendations you can audit.</h2>
            <p>
              ReturnOS suggests — people decide. Every score shows its reasons;
              every recommendation shows its math; overrides require a reason.
            </p>
          </div>
        </Reveal>
        <div className={styles.intelGrid}>
          <Reveal>
            <article className={styles.decision} aria-label="Sample disposition evaluation">
              <header className={styles.decisionHead}>
                <div>
                  <p className={styles.eyebrowSmall}>Disposition evaluation · sample</p>
                  <h3>RET-2026-0839 · Meridian Jacket</h3>
                </div>
                <span className={`${styles.stamp} ${styles.stampInfo}`}>risk 18 · low</span>
              </header>
              <ul className={styles.decisionRows}>
                {CANDIDATES.map((c) => (
                  <li key={c.ch} className={`${styles.decisionRow} ${c.pick ? styles.decisionPick : ''} ${c.eligible ? '' : styles.decisionOut}`}>
                    <span className={styles.decisionCh}>{c.ch}</span>
                    <span className={styles.decisionNote}>{c.note}</span>
                    <span className={`${styles.data} ${styles.decisionNet}`}>{c.net} net</span>
                    {c.pick && <span className={`${styles.stamp} ${styles.stampOk}`}>recommended</span>}
                    {!c.eligible && <span className={styles.metaDim}>not eligible</span>}
                  </li>
                ))}
              </ul>
              <p className={styles.sampleNote}>Sample economics — real evaluations run on your return data.</p>
            </article>
          </Reveal>
          <div className={styles.signals}>
            {SIGNALS.map((s, i) => (
              <Reveal as="li" key={s.name} delay={i * 60}>
                <h3>{s.name}</h3>
                <p>{s.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
