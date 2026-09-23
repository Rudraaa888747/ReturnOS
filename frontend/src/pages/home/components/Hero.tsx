import { useEffect, useState } from 'react'
import type { FocusEvent, KeyboardEvent } from 'react'
import { ArrowRight, Minus, Package, ScanLine, Square, X } from 'lucide-react'
import { useReducedMotion } from '../../../hooks/useReducedMotion'
import styles from '../home.module.css'

const STEPS = ['Initiated', 'In transit', 'Received', 'Inspection', 'Disposition', 'Recovery'] as const
const NEXT = [
  'Waiting for warehouse approval',
  'Carrier scan expected at Ahmedabad hub',
  'Dock 4 · assign an inspection slot',
  'Recording condition, packaging, function',
  'Best net-recovery channel wins',
  'Settled — value back on the books',
]

/** Mac-style operational console for RET-2026-0841 (sample data).
 *  Window buttons work (close / minimize / zoom) and every route node is
 *  clickable — dots, labels, and Prev/Next all drive the same stage. */
function OpsConsole() {
  const reduced = useReducedMotion()
  const [stage, setStage] = useState(3)
  const [paused, setPaused] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [closed, setClosed] = useState(false)

  useEffect(() => {
    if (reduced || paused || minimized || closed) return
    const t = window.setInterval(() => setStage((s) => (s + 1) % STEPS.length), 3200)
    return () => window.clearInterval(t)
  }, [reduced, paused, minimized, closed])

  const progress = stage / (STEPS.length - 1)

  function goTo(i: number) {
    setStage(i)
    setPaused(true)
  }

  function onDotKey(e: KeyboardEvent, i: number) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      goTo(i)
    }
  }

  // Pause while hovered or while focus is anywhere inside the console.
  function onFocusIn() {
    setPaused(true)
  }
  function onFocusOut(e: FocusEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false)
  }

  if (closed) {
    return (
      <button type="button" className={styles.consoleReopen} onClick={() => setClosed(false)}>
        Reopen RET-2026-0841
      </button>
    )
  }

  return (
    <div
      className={`${styles.console} ${minimized ? styles.consoleMinimized : ''}`}
      role="region"
      aria-label="Interactive illustration of return RET-2026-0841. Use the route nodes or Prev and Next to walk through its stages."
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={onFocusIn}
      onBlurCapture={onFocusOut}
    >
      <div className={styles.consoleBar}>
        <span className={styles.traffic}>
          <button
            type="button"
            className={styles.trafficRed}
            aria-label="Close return window"
            title="Close"
            onClick={() => setClosed(true)}
          >
            <X size={7} className={styles.trafficIcon} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.trafficYellow}
            aria-label={minimized ? 'Restore return window' : 'Minimize return window'}
            title={minimized ? 'Restore' : 'Minimize'}
            aria-pressed={minimized}
            onClick={() => setMinimized((m) => !m)}
          >
            <Minus size={7} className={styles.trafficIcon} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.trafficGreen}
            aria-label="Zoom return window"
            title="Zoom"
            onClick={() => setMinimized(false)}
          >
            <Square size={6} className={styles.trafficIcon} aria-hidden="true" />
          </button>
        </span>
        <span className={styles.consolePath}>returnos / returns / RET-2026-0841</span>
        <span className={styles.liveDot}>live view</span>
      </div>

      {!minimized && (
        <div className={styles.consoleBody}>
          <div className={styles.consoleHead}>
            <div>
              <p className={styles.consoleId}>RET-2026-0841</p>
              <p className={styles.consoleItem}>1 × Aurora Headphones · SKU-HEADPH-001 · Defective</p>
            </div>
            <span key={stage} className={`${styles.stamp} ${styles.stampInfo} ${styles.swap}`}>
              ● {STEPS[stage]}
            </span>
          </div>

          <svg className={styles.route} viewBox="0 0 560 64" role="group" aria-label="Return route stages. Activate a node to jump to it.">
            <line x1="14" y1="32" x2="546" y2="32" stroke="var(--line)" strokeWidth="2" />
            <line
              x1="14"
              y1="32"
              x2="546"
              y2="32"
              stroke="var(--brand)"
              strokeWidth="2"
              strokeDasharray="532"
              strokeDashoffset={532 - 532 * progress}
              style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(.2,0,.2,1)' }}
            />
            {STEPS.map((s, i) => {
              const x = 14 + (532 / (STEPS.length - 1)) * i
              const done = i < stage
              const now = i === stage
              return (
                <g
                  key={s}
                  className={styles.dotBtn}
                  tabIndex={0}
                  role="button"
                  aria-label={`Go to stage ${s}${now ? ' (current stage)' : ''}`}
                  aria-current={now ? 'step' : undefined}
                  onClick={() => goTo(i)}
                  onKeyDown={(e) => onDotKey(e, i)}
                >
                  {/* Large invisible hit area to make clicking easier */}
                  <circle cx={x} cy="32" r="14" fill="transparent" />
                  <circle
                    cx={x}
                    cy="32"
                    r={now ? 8 : 6}
                    fill={done ? 'var(--brand)' : 'var(--surface)'}
                    stroke={done || now ? 'var(--brand)' : 'var(--line-strong)'}
                    strokeWidth="2.5"
                  />
                  {done && <circle cx={x} cy="32" r="2.2" fill="#fff" />}
                </g>
              )
            })}
          </svg>
          <div className={styles.routeLabels}>
            {STEPS.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => goTo(i)}
                aria-current={i === stage ? 'step' : undefined}
                className={`${styles.routeLabelBtn} ${i === stage ? styles.routeNow : i < stage ? styles.routeDone : ''}`}
              >
                {s}
              </button>
            ))}
          </div>

          <dl className={styles.consoleGrid}>
            <div>
              <dt>Warehouse node</dt>
              <dd>AMD-02 · Ahmedabad</dd>
            </div>
            <div>
              <dt>Recovery value</dt>
              <dd>₹7,000 net</dd>
            </div>
            <div>
              <dt>Processing time</dt>
              <dd>31h 12m · within SLA</dd>
            </div>
            <div>
              <dt>Recommendation</dt>
              <dd>Refurbish · bench B-14</dd>
            </div>
          </dl>

          <p key={`n-${stage}`} className={`${styles.consoleNext} ${styles.swap}`}>
            <Package size={15} aria-hidden="true" /> Next: {NEXT[stage]}
          </p>

          <div className={styles.consoleStepNav}>
            <button
              type="button"
              disabled={stage === 0}
              onClick={() => goTo(Math.max(0, stage - 1))}
              aria-label="Previous stage"
            >
              ← Prev
            </button>
            <span className={styles.data} aria-live="polite">
              {stage + 1} / {STEPS.length}
            </span>
            <button
              type="button"
              disabled={stage === STEPS.length - 1}
              onClick={() => goTo(Math.min(STEPS.length - 1, stage + 1))}
              aria-label="Next stage"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function Hero() {
  return (
    <section className={styles.hero} aria-labelledby="hero-h">
      <div className={styles.wrap}>
        <p className={styles.heroEyebrow}>
          <ScanLine size={14} aria-hidden="true" /> Returns management · reverse logistics · warehouse operations
        </p>
        <div className={styles.heroGrid}>
          <div>
            <h1 id="hero-h">
              Returns shouldn&rsquo;t be the end of the journey.
            </h1>
            <p className={styles.heroSub}>
              ReturnOS turns reverse logistics into a controlled, visible operation —
              from return initiation to inspection, disposition, and recovered
              value. One system for customers, warehouse teams, and admins.
            </p>
            <div className={styles.heroCtas}>
              <a href="/signup" className={styles.ctaPrimary}>
                Get started <ArrowRight size={16} aria-hidden="true" />
              </a>
              <a href="#track" className={styles.ctaQuiet}>
                Track a return
              </a>
            </div>
            <dl className={styles.heroProof}>
              <div>
                <dt>Request → resolution</dt>
                <dd>one connected lifecycle</dd>
              </div>
              <div>
                <dt>7 recovery channels</dt>
                <dd>evaluated on net value</dd>
              </div>
              <div>
                <dt>Full audit trail</dt>
                <dd>every state change kept</dd>
              </div>
            </dl>
          </div>
          <div>
            <OpsConsole />
            <p className={styles.visualCaption}>
              Sample operational view — figures are illustrative, not live data.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
