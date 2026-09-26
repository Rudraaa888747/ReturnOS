import { ArrowRight, FileCheck2, Plug2, ShieldCheck } from 'lucide-react'
import { Reveal } from '../Reveal'
import { Curve } from './Curve'
import styles from '../home.module.css'

const STEPS = [
  { no: '01', title: 'Connect', body: 'Create workspaces for customers, warehouse staff, and admins. Orders and products flow in; roles and permissions are enforced from day one.' },
  { no: '02', title: 'Receive', body: 'Approve requests, accept carrier shipments or counter drop-offs, and dock every parcel with its channel stamped on the record.' },
  { no: '03', title: 'Inspect', body: 'Grade condition, packaging, accessories, and function. Structured evidence replaces hallway opinions.' },
  { no: '04', title: 'Decide', body: 'Review the risk score and the net-recovery ranking. Finalize the recommendation — or override it with a mandatory reason.' },
  { no: '05', title: 'Recover', body: 'Execute the channel, settle vendor claims and resales, and watch recovery land in analytics. Every step stays auditable.' },
]

const PROOF = [
  { icon: <ShieldCheck size={18} aria-hidden="true" />, title: 'Auditable by design', body: 'Immutable event log per return — who did what, when, and why. Actors are hidden from customers, visible to operators.' },
  { icon: <FileCheck2 size={18} aria-hidden="true" />, title: 'Workflow control', body: 'Versioned records with optimistic locking. Invalid transitions return errors; concurrent edits never silently overwrite.' },
  { icon: <Plug2 size={18} aria-hidden="true" />, title: 'Built to integrate', body: 'Commerce, ERP, warehouse, shipping, and analytics categories are integration points on the roadmap — the API surface is versioned under /api/v1.' },
]

export function Process() {
  return (
    <section className={`${styles.section} ${styles.sectionFlow} ${styles.toneSurface}`} id="how" aria-labelledby="how-h">
      <Curve tone="var(--paper)" variant="rise" />
      <div className={styles.wrap}>
        <Reveal motion="fade">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>How it works</p>
            <h2 id="how-h">Live in five moves.</h2>
            <p>From first request to settled recovery — the same path for every return.</p>
          </div>
        </Reveal>
        <ol className={styles.process}>
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.no} delay={Math.min(i, 2) * 60}>
              <span className={styles.processNo} aria-hidden="true">
                {s.no}
              </span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}

export function Proof() {
  return (
    <section className={`${styles.section} ${styles.sectionFlow} ${styles.toneSunken}`} aria-labelledby="trust-h">
      <Curve tone="var(--surface)" variant="scoop" flip />
      <div className={styles.wrap}>
        <Reveal motion="fade">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>Trust</p>
            <h2 id="trust-h">Operations you can defend in an audit.</h2>
            <p>No invented logos, no borrowed certifications — just product capabilities that hold up under scrutiny.</p>
          </div>
        </Reveal>
        <ul className={styles.proof}>
          {PROOF.map((p, i) => (
            <Reveal as="li" key={p.title} delay={i * 60}>
              <article className={styles.proofCard}>
                <span className={styles.proofIcon}>{p.icon}</span>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </article>
            </Reveal>
          ))}
        </ul>
        <Reveal motion="fade">
          <div className={styles.integrations} aria-label="Integration categories">
            <span className={styles.integrationLabel}>Connects with your stack</span>
            <ul>
              {['Commerce', 'ERP', 'Warehouse', 'Shipping', 'Analytics'].map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p>Categories shown are integration surfaces, not claimed partnerships.</p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

export function FinalCta() {
  return (
    <section className={`${styles.section} ${styles.sectionFlow}`} aria-labelledby="cta-h">
      <Curve tone="var(--surface-sunken)" variant="drift" />
      <div className={styles.wrap}>
        <Reveal>
          <div className={styles.bandCta}>
            <div>
              <h2 id="cta-h">Take control of every return.</h2>
              <p>Visible inventory, decided outcomes, recovered value — from the first request to the final settlement.</p>
            </div>
            <div className={styles.bandCtas}>
              <a href="/signup" className={styles.ctaLight}>
                Get started <ArrowRight size={16} aria-hidden="true" />
              </a>
              <a href="#how" className={styles.ctaGhost}>
                See how it works
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
