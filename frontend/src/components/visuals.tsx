import { Check } from 'lucide-react'
import { dispositionLabel, money } from '../lib/format'
import type { Disposition, DispositionCandidate } from '../lib/types'
import styles from './visuals.module.css'

/* ---------- Journey timeline ---------- */

export interface TimelineStep {
  key: string
  title: string
  detail?: string
  state: 'done' | 'now' | 'todo'
}

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className={styles.timeline} aria-label="Return journey">
      {steps.map((step) => (
        <li
          key={step.key}
          className={`${styles.step} ${step.state === 'done' ? styles.stepDone : ''} ${step.state === 'now' ? styles.stepNow : ''}`}
          aria-current={step.state === 'now' ? 'step' : undefined}
        >
          <span className={styles.marker} aria-hidden="true">
            {step.state === 'done' && <Check size={14} strokeWidth={3} />}
            {step.state === 'now' && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor' }} />}
          </span>
          <div className={styles.stepBody}>
            <strong>
              {step.title}
              {step.state === 'now' && <span className="meta"> — current stage</span>}
            </strong>
            {step.detail && <span>{step.detail}</span>}
          </div>
        </li>
      ))}
    </ol>
  )
}

/* ---------- Donut (hand-rolled SVG, real data only) ---------- */

export function Donut({
  slices,
  size = 148,
  label,
}: {
  slices: { key: string; label: string; value: number; color: string }[]
  size?: number
  label: string
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  const radius = 58
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className={styles.donutWrap}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 148 148"
        role="img"
        aria-label={total === 0 ? `${label}: no data` : `${label}: ${slices.map((s) => `${s.label} ${s.value}`).join(', ')}`}
      >
        <circle cx="74" cy="74" r={radius} fill="none" stroke="var(--surface-sunken)" strokeWidth="20" />
        {total > 0 &&
          slices.map((s) => {
            if (s.value <= 0) return null
            const frac = s.value / total
            const el = (
              <circle
                key={s.key}
                cx="74"
                cy="74"
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth="20"
                strokeDasharray={`${frac * circumference} ${circumference}`}
                strokeDashoffset={-offset * circumference}
                strokeLinecap="butt"
                transform="rotate(-90 74 74)"
              />
            )
            offset += frac
            return el
          })}
        <text x="74" y="70" textAnchor="middle" fontSize="24" fontWeight="600" fill="var(--ink)" fontFamily="var(--font-data)">
          {total}
        </text>
        <text x="74" y="90" textAnchor="middle" fontSize="11" fill="var(--ink-3)">
          {total === 1 ? 'return' : 'returns'}
        </text>
      </svg>
      <ul className={styles.donutLegend}>
        {slices.map((s) => (
          <li key={s.key}>
            <span className={styles.swatch} style={{ background: s.color }} aria-hidden="true" />
            {s.label} · <span className="data">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- Grouped bars ---------- */

export function Bars({
  rows,
  format,
}: {
  rows: { key: string; label: string; value: number; color?: string }[]
  format: (value: number) => string
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className={styles.bars} role="list" aria-label="Comparison bars">
      {rows.map((row) => (
        <div className={styles.barRow} key={row.key} role="listitem">
          <span className={styles.barLabel}>{row.label}</span>
          <span className={styles.barTrack} aria-hidden="true">
            <span
              className={styles.barFill}
              style={{ width: `${(row.value / max) * 100}%`, background: row.color ?? 'var(--brand)' }}
            />
          </span>
          <span className={styles.barValue}>{format(row.value)}</span>
        </div>
      ))}
    </div>
  )
}

/* ---------- Disposition marker (muted dot + label) ---------- */

const dispVar: Record<Disposition, string> = {
  RESTOCK: 'var(--disp-restock)',
  REFURBISH: 'var(--disp-refurbish)',
  RESELL: 'var(--disp-resell)',
  RETURN_TO_VENDOR: 'var(--disp-vendor)',
  LIQUIDATE: 'var(--disp-liquidate)',
  RECYCLE: 'var(--disp-recycle)',
  SCRAP: 'var(--disp-scrap)',
}

export function DispositionMark({ value }: { value: Disposition }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
      <span
        aria-hidden="true"
        style={{ width: 8, height: 8, borderRadius: '50%', background: dispVar[value], flex: 'none' }}
      />
      {dispositionLabel[value]}
    </span>
  )
}

/* ---------- Disposition candidates ---------- */

export function CandidateList({ candidates, picked }: { candidates: DispositionCandidate[]; picked: string }) {
  return (
    <div className={styles.candidates}>
      {candidates.map((c) => (
        <article
          key={c.disposition}
          className={`${styles.candidate} ${c.disposition === picked ? styles.candidatePicked : ''}`}
          aria-label={`${c.disposition} ${c.eligible ? 'eligible' : 'not eligible'}`}
        >
          <div className={styles.candidateHead}>
            <DispositionMark value={c.disposition} />
            {!c.eligible && <span className="meta">Not eligible</span>}
            {c.disposition === picked && c.eligible && <span className="meta">Recommended</span>}
            <span className={styles.candidateNet}>{money(c.netRecovery)} net</span>
          </div>
          <div className={styles.candidateDims}>
            <span>
              Recovery <b>{money(c.recoveryValue)}</b>
            </span>
            <span>
              Processing <b>{money(c.processingCost)}</b>
            </span>
            <span>
              Shipping <b>{money(c.shippingCost)}</b>
            </span>
            <span>
              Refurbish <b>{money(c.refurbishmentCost)}</b>
            </span>
          </div>
          <p className={styles.candidateReason}>{c.reason}</p>
        </article>
      ))}
    </div>
  )
}
