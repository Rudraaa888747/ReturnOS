import { useEffect, useRef, useState } from 'react'
import { Reveal } from '../Reveal'
import { Curve } from './Curve'
import { useCountUp } from './useCountUp'
import styles from '../home.module.css'

const BARS = [
  { label: 'Restock', pct: 82, value: '82%' },
  { label: 'Refurbish', pct: 64, value: '64%' },
  { label: 'Resell', pct: 47, value: '47%' },
  { label: 'Vendor', pct: 31, value: '31%' },
  { label: 'Recycle', pct: 18, value: '18%' },
]

function Metric({ target, prefix = '', suffix = '', label, sub, started }: { target: number; prefix?: string; suffix?: string; label: string; sub: string; started: boolean }) {
  const v = useCountUp(target, started)
  return (
    <div className={styles.metric}>
      <p className={`${styles.data} ${styles.metricValue}`} aria-live="off">
        {prefix}
        {v.toLocaleString('en-IN')}
        {suffix}
      </p>
      <p className={styles.metricLabel}>{label}</p>
      <p className={styles.metricSub}>{sub}</p>
    </div>
  )
}

export function Analytics() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setStarted(true)
      return
    }
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setStarted(true)
          ob.disconnect()
        }
      },
      { threshold: 0.3 },
    )
    ob.observe(el)
    return () => ob.disconnect()
  }, [])

  return (
    <section className={`${styles.section} ${styles.sectionFlow} ${styles.toneSurface}`} id="analytics" aria-labelledby="analytics-h">
      <Curve tone="var(--paper)" variant="rise" flip />
      <div className={styles.wrap}>
        <Reveal motion="fade">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>Analytics</p>
            <h2 id="analytics-h">Know what returns cost — and what they return.</h2>
            <p>
              Return rate, processing time, recovery value, restock rate,
              disposition mix, SLA performance. Aggregated from real operations,
              not pasted from a template.
            </p>
          </div>
        </Reveal>
        <Reveal>
          <div ref={ref} className={styles.analytics}>
            <div className={styles.metrics}>
              <Metric target={32} suffix="h" label="Median processing time" sub="request → resolution · sample" started={started} />
              <Metric target={4280} prefix="₹" label="Recovery per return" sub="net, across channels · sample" started={started} />
              <Metric target={68} suffix="%" label="Restock rate" sub="sealed + like-new · sample" started={started} />
              <Metric target={94} suffix="%" label="SLA compliance" sub="inspect within 48h · sample" started={started} />
            </div>
            <div className={styles.mixPanel}>
              <div className={styles.mixHead}>
                <h3>Disposition mix</h3>
                <span className={styles.sampleTag}>sample data</span>
              </div>
              <ul className={styles.mixBars}>
                {BARS.map((b) => (
                  <li key={b.label}>
                    <span>{b.label}</span>
                    <span className={styles.mixTrack} aria-hidden="true">
                      <span className={styles.mixFill} style={{ width: started ? `${b.pct}%` : '0%' }} />
                    </span>
                    <span className={styles.data}>{b.value}</span>
                  </li>
                ))}
              </ul>
              <p className={styles.mixNote}>Expected vs recovered, vendor settlement, and completion rate ship in the admin workspace.</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
