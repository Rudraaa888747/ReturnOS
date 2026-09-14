import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Loader2,
  Lock,
  SearchX,
  ServerCrash,
  WifiOff,
} from 'lucide-react'
import styles from './ui.module.css'

/* ---------- Buttons ---------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger'
  size?: 'md' | 'sm'
  ref?: React.Ref<HTMLButtonElement>
}

export function Button({ variant = 'secondary', size = 'md', className = '', ref, ...rest }: ButtonProps) {
  const cls = [styles.btn, styles[`btn${variant[0].toUpperCase()}${variant.slice(1)}`], size === 'sm' ? styles.btnSm : '', className]
    .filter(Boolean)
    .join(' ')
  return <button type="button" ref={ref} className={cls} {...rest} />
}

export function LinkButton({
  to,
  variant = 'secondary',
  size = 'md',
  children,
}: {
  to: string
  variant?: 'primary' | 'secondary' | 'danger'
  size?: 'md' | 'sm'
  children: ReactNode
}) {
  const cls = [styles.btn, styles[`btn${variant[0].toUpperCase()}${variant.slice(1)}`], size === 'sm' ? styles.btnSm : '']
    .filter(Boolean)
    .join(' ')
  return (
    <Link to={to} className={cls}>
      {children}
    </Link>
  )
}

/* ---------- Fields ---------- */

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && <span className={styles.fieldHint}>{hint}</span>}
      {error && (
        <span className={styles.fieldError} role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const { invalid, className = '', ...rest } = props
  return <input className={`${styles.input} ${invalid ? styles.inputError : ''} ${className}`} {...rest} />
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={styles.select} {...props} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={styles.textarea} {...props} />
}

/* ---------- Layout ---------- */

export function PageHead({ title, intro, actions }: { title: string; intro?: string; actions?: ReactNode }) {
  return (
    <div className={styles.pageHead}>
      <h1>{title}</h1>
      {intro && <p>{intro}</p>}
      {actions && <div style={{ marginTop: 'var(--sp-4)', display: 'flex', gap: 'var(--sp-2)' }}>{actions}</div>}
    </div>
  )
}

export function Panel({ title, sub, children }: { title?: string; sub?: string; children: ReactNode }) {
  return (
    <section className={styles.panel}>
      {title && <h2 className={styles.panelTitle}>{title}</h2>}
      {sub && <p className={styles.panelSub}>{sub}</p>}
      {children}
    </section>
  )
}

/* ---------- Badges ---------- */

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'neutral'

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const toneClass =
    tone === 'neutral'
      ? ''
      : tone === 'ok'
        ? styles.badgeOk
        : tone === 'warn'
          ? styles.badgeWarn
          : tone === 'bad'
            ? styles.badgeBad
            : tone === 'info'
              ? styles.badgeInfo
              : styles.badgeBrand
  return (
    <span className={`${styles.badge} ${toneClass}`}>
      <span className={styles.dot} aria-hidden="true" />
      {children}
    </span>
  )
}

export function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className={styles.metricValue}>{value}</div>
      <div className={styles.metricLabel}>{label}</div>
    </div>
  )
}

/* ---------- Tables ---------- */

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  rowKey,
  empty,
  caption,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey?: (row: T) => string
  empty: ReactNode
  caption: string
}) {
  if (rows.length === 0) return <>{empty}</>
  const key = rowKey ?? ((row: T) => row.id)
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={key(row)}>
              {columns.map((c) => (
                <td key={c.key} data-th={c.header}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Pagination({
  page,
  totalPages,
  totalElements,
  onPage,
  label,
}: {
  page: number
  totalPages: number
  totalElements: number
  onPage: (page: number) => void
  label: string
}) {
  return (
    <div className={styles.pager}>
      <Button
        size="sm"
        disabled={page <= 0}
        onClick={() => onPage(page - 1)}
        aria-label={`Previous page of ${label}`}
      >
        Previous
      </Button>
      <span aria-live="polite">
        Page {page + 1} of {Math.max(totalPages, 1)} · {totalElements} {label}
      </span>
      <Button
        size="sm"
        disabled={page + 1 >= totalPages}
        onClick={() => onPage(page + 1)}
        aria-label={`Next page of ${label}`}
      >
        Next
      </Button>
    </div>
  )
}

/* ---------- States ---------- */

export function EmptyState({
  icon = <Inbox size={20} aria-hidden="true" />,
  title,
  body,
  action,
}: {
  icon?: ReactNode
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className={styles.stateBox}>
      <span className={styles.stateIcon}>{icon}</span>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  )
}

const stateIcons = {
  empty: <Inbox size={20} aria-hidden="true" />,
  forbidden: <Lock size={20} aria-hidden="true" />,
  'not-found': <SearchX size={20} aria-hidden="true" />,
  error: <ServerCrash size={20} aria-hidden="true" />,
  offline: <WifiOff size={20} aria-hidden="true" />,
}

export function ErrorState({
  kind = 'error',
  title,
  body,
  onRetry,
}: {
  kind?: keyof typeof stateIcons
  title: string
  body: string
  onRetry?: () => void
}) {
  return (
    <div className={styles.stateBox} role="alert">
      <span className={styles.stateIcon}>{stateIcons[kind]}</span>
      <h2>{title}</h2>
      <p>{body}</p>
      <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
        {onRetry && (
          <Button variant="primary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  )
}

/** Maps backend/API failures to the right state visual. */
export function LoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
  const lower = error.toLowerCase()
  if (lower.includes('connection') || lower.includes('reach')) {
    return (
      <ErrorState kind="offline" title="You're offline" body="Could not reach the ReturnOS service. Check your connection and try again." onRetry={onRetry} />
    )
  }
  if (lower.includes('forbidden') || lower.includes('denied') || lower.includes('access denied')) {
    return <ErrorState kind="forbidden" title="Not allowed" body={error} />
  }
  if (lower.includes('not found')) {
    return <ErrorState kind="not-found" title="Not found" body={error} />
  }
  return <ErrorState kind="error" title="Couldn't load this view" body={error} onRetry={onRetry} />
}

export function Skeleton({ width = '100%', height = 14 }: { width?: string | number; height?: string | number }) {
  return <div className={styles.skeleton} style={{ width, height }} aria-hidden="true" />
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton width={220} height={26} />
      <div style={{ height: 'var(--sp-4)' }} />
      <Skeleton width="60%" height={14} />
      <div style={{ height: 'var(--sp-6)' }} />
      <Skeleton height={120} />
    </div>
  )
}

export function InlineSpinner({ label = 'Working…' }: { label?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-2)' }} role="status">
      <Loader2 size={15} aria-hidden="true" className="spin" />
      {label}
    </span>
  )
}

export function SuccessNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      style={{
        display: 'flex',
        gap: 'var(--sp-2)',
        alignItems: 'center',
        background: 'var(--ok-soft)',
        border: '1px solid var(--ok)',
        color: 'var(--ok)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--sp-2) var(--sp-3)',
        fontWeight: 500,
      }}
    >
      <CheckCircle2 size={16} aria-hidden="true" /> {children}
    </p>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p
      role="alert"
      style={{
        display: 'flex',
        gap: 'var(--sp-2)',
        alignItems: 'center',
        background: 'var(--bad-soft)',
        border: '1px solid var(--bad)',
        color: 'var(--bad)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--sp-2) var(--sp-3)',
        fontWeight: 500,
      }}
    >
      <AlertTriangle size={16} aria-hidden="true" /> {message}
    </p>
  )
}
