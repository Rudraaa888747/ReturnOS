import { useState } from 'react'
import type { FormEvent } from 'react'
import { Loader2, PackageSearch, Search } from 'lucide-react'
import { lookupReturn, normalizeId, SAMPLE_IDS } from './demo'
import type { DemoReturn } from './demo'
import { Reveal } from '../Reveal'
import styles from '../home.module.css'

type State =
  | { kind: 'idle' }
  | { kind: 'loading'; id: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'error'; id: string }
  | { kind: 'success'; record: DemoReturn }

export function TrackReturn() {
  const [input, setInput] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const id = normalizeId(input)
    if (!id) {
      setState({ kind: 'invalid', message: 'Use the format RET-YYYY-NNNN — for example RET-2026-0841.' })
      return
    }
    setState({ kind: 'loading', id })
    const record = await lookupReturn(id)
    setState(record ? { kind: 'success', record } : { kind: 'error', id })
  }

  return (
    <section className={styles.section} id="track" aria-labelledby="track-h">
      <div className={styles.wrap}>
        <Reveal motion="fade">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>Visibility</p>
            <h2 id="track-h">Track a return like a shipment manifest.</h2>
            <p>
              Type a return ID to see where the parcel stands, what inspection
              found, and which recovery path it is on. Demo below — wire it to
              your tracking API when ready.
            </p>
          </div>
        </Reveal>
        <Reveal>
          <div className={styles.trackPanel}>
            <form onSubmit={onSubmit} className={styles.trackForm} noValidate={false}>
              <label htmlFor="track-input" className={styles.trackLabel}>
                Return ID
              </label>
              <div className={styles.trackRow}>
                <span className={styles.trackIcon} aria-hidden="true">
                  <Search size={17} />
                </span>
                <input
                  id="track-input"
                  className={styles.trackInput}
                  placeholder="RET-2026-0841"
                  autoComplete="off"
                  spellCheck={false}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  aria-describedby="track-hint track-status"
                  aria-invalid={state.kind === 'invalid'}
                />
                <button
                  type="submit"
                  className={styles.ctaPrimary}
                  disabled={state.kind === 'loading'}
                >
                  {state.kind === 'loading' ? (
                    <>
                      <Loader2 size={16} aria-hidden="true" className="spin" /> Locating…
                    </>
                  ) : (
                    'Track'
                  )}
                </button>
              </div>
              <p id="track-hint" className={styles.trackHint}>
                Sample IDs: {SAMPLE_IDS.join(' · ')}. Format RET-YYYY-NNNN.
              </p>
            </form>

            <div id="track-status" aria-live="polite" className={styles.trackResult}>
              {state.kind === 'idle' && (
                <p className={styles.trackIdle}>
                  <PackageSearch size={16} aria-hidden="true" /> Enter an ID above — the manifest appears here.
                </p>
              )}
              {state.kind === 'loading' && (
                <p className={styles.trackIdle}>
                  <Loader2 size={16} aria-hidden="true" className="spin" /> Locating {state.id} across hubs…
                </p>
              )}
              {state.kind === 'invalid' && (
                <p role="alert" className={styles.trackError}>
                  {state.message}
                </p>
              )}
              {state.kind === 'error' && (
                <div role="alert" className={styles.trackErrorBox}>
                  <strong>No record for {state.id} in this demo.</strong>
                  <span>Try one of the sample IDs: {SAMPLE_IDS.join(', ')}.</span>
                </div>
              )}
              {state.kind === 'success' && <Ticket record={state.record} />}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Ticket({ record }: { record: DemoReturn }) {
  return (
    <article className={styles.ticket} aria-label={`Tracking result for ${record.id}`}>
      <header className={styles.ticketHead}>
        <div>
          <p className={`${styles.data} ${styles.ticketId}`}>{record.id}</p>
          <p className={styles.ticketItem}>{record.item}</p>
        </div>
        <span className={`${styles.stamp} ${styles.stampOk}`}>{record.status}</span>
      </header>
      <ol className={styles.ticketStages}>
        {record.stages.map((s) => (
          <li
            key={s.key}
            className={`${styles.tStage} ${s.state === 'done' ? styles.tDone : ''} ${s.state === 'now' ? styles.tNow : ''}`}
            aria-current={s.state === 'now' ? 'step' : undefined}
          >
            <span className={styles.tDot} aria-hidden="true" />
            <strong>{s.label}</strong>
            <span>{s.detail}</span>
          </li>
        ))}
      </ol>
      <dl className={styles.ticketGrid}>
        <div>
          <dt>Received at</dt>
          <dd>{record.warehouse}</dd>
        </div>
        <div>
          <dt>Inspection</dt>
          <dd>{record.inspection}</dd>
        </div>
        <div>
          <dt>Disposition</dt>
          <dd>{record.disposition}</dd>
        </div>
        <div>
          <dt>Recovery value</dt>
          <dd className={styles.data}>{record.recoveryValue}</dd>
        </div>
        <div>
          <dt>Heading to</dt>
          <dd>{record.destination}</dd>
        </div>
        <div>
          <dt>Timeline</dt>
          <dd>{record.eta}</dd>
        </div>
      </dl>
      <p className={styles.sampleNote}>Sample data — connect the tracking API to show live returns.</p>
    </article>
  )
}
