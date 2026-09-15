import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Package } from 'lucide-react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import styles from './home.module.css'

const STEPS = ['Requested', 'Approved', 'In transit', 'Received', 'Inspected', 'Resolved'] as const
const NEXT = [
  'Waiting for warehouse approval',
  'Ship the parcel',
  'Receive at warehouse',
  'Record inspection',
  'Evaluate disposition',
  'Settled — history complete',
]
const STAGE_MS = 3000

/**
 * Controlled product simulation built from real ReturnOS concepts
 * (return number, status, item, risk, recommendation, next action).
 * Advances one lifecycle stage at a time; pauses on hover/focus;
 * renders a calm static snapshot when reduced motion is preferred.
 */
function ProductVisual() {
  const reduced = useReducedMotion()
  const [stage, setStage] = useState(3)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (reduced || paused) return
    const timer = window.setInterval(() => setStage((s) => (s + 1) % STEPS.length), STAGE_MS)
    return () => window.clearInterval(timer)
  }, [reduced, paused])

  const assessed = stage >= 4
  const progress = stage / (STEPS.length - 1)

  return (
    <div
      className={styles.visual}
      role="img"
      aria-label="Animated illustration of a return moving through its lifecycle, from requested to resolved."
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className={styles.visualBar} aria-hidden="true">
        <span className={styles.traffic}>
          <i />
          <i />
          <i />
        </span>
        <span>returnos / returns / RET-2026-0841</span>
      </div>
      <div className={styles.visualBody} aria-hidden="true">
        <div className={styles.visualRow}>
          <span className={styles.visualId}>RET-2026-0841</span>
          <span
            key={stage}
            className={styles.vNextSwap}
            style={{
              fontSize: 'var(--fs-label)',
              fontWeight: 600,
              color: 'var(--info)',
              background: 'var(--info-soft)',
              border: '1px solid var(--info)',
              borderRadius: 'var(--radius-sm)',
              padding: '2px 8px',
            }}
          >
            ● {STEPS[stage]}
          </span>
        </div>
        <p className={styles.visualItem}>
          1 × Aurora Headphones <span style={{ color: 'var(--ink-faint)' }}>SKU-HEADPH-001 · Defective</span>
        </p>
        <div className={styles.visualSteps}>
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={`${styles.vStep} ${i < stage ? styles.vStepDone : ''} ${i === stage ? styles.vStepNow : ''}`}
            >
              {s}
            </span>
          ))}
        </div>
        <div className={styles.vTrack}>
          <div className={styles.vFill} style={{ transform: `scaleX(${progress})` }} />
        </div>
        <div className={styles.visualGrid}>
          <div className={styles.visualCell}>
            <div className="k">Risk</div>
            <div className="v">{assessed ? '24 · LOW' : '—'}</div>
          </div>
          <div className={styles.visualCell}>
            <div className="k">Recommended</div>
            <div className="v">{assessed ? 'REFURBISH · ₹7,000 net' : '—'}</div>
          </div>
        </div>
        <div className={styles.visualNext} key={stage}>
          <span className={styles.vNextSwap} style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            <Package size={15} /> Next: {NEXT[stage]}
          </span>
        </div>
      </div>
    </div>
  )
}

export function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.wrap}>
        <div className={styles.heroGrid}>
          <div>
            <h1>The operating system for reverse logistics.</h1>
            <p className={styles.heroSub}>
              Manage returns from request to resolution through one connected operational workflow.
            </p>
            <div className={styles.heroCtas}>
              <Link to="/register" className={styles.ctaPrimary}>
                Explore ReturnOS
              </Link>
              <a href="#workflow" className={styles.ctaQuiet}>
                See how it works
              </a>
            </div>
            <p className={styles.heroMeta}>Customers · Warehouse teams · Admins — one system, three workspaces.</p>
          </div>
          <div>
            <ProductVisual />
            <p className={styles.visualCaption}>Illustrated from real ReturnOS concepts — not a screenshot.</p>
          </div>
        </div>
      </div>
    </section>
  )
}
