import type { ReactNode } from 'react'
import { AlertCircle, Inbox, RotateCcw } from 'lucide-react'
import styles from './ui.module.css'

export function PageHead({ kicker, title, lede, actions }: { kicker?: string; title: string; lede?: string; actions?: ReactNode }) {
  return (
    <div className={styles.head}>
      <div>
        {kicker && <p className={styles.kicker}>{kicker}</p>}
        <h1 className={styles.title}>{title}</h1>
        {lede && <p className={styles.lede}>{lede}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  )
}

const TONE: Record<string, string> = {
  ok: styles.toneOk,
  warn: styles.toneWarn,
  bad: styles.toneBad,
  info: styles.toneInfo,
}

export function StatusBadge({ tone = 'info', children }: { tone?: 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return (
    <span className={`${styles.badge} ${TONE[tone]}`}>
      <span aria-hidden="true">●</span> {children}
    </span>
  )
}

export function statusTone(status: string): 'ok' | 'warn' | 'bad' | 'info' {
  const normalized = status.toUpperCase()
  if (['COMPLETED', 'RESOLVED', 'SETTLED', 'APPROVED', 'DELIVERED', 'RECEIVED', 'CLOSED'].includes(normalized)) {
    return 'ok'
  }
  if (['REJECTED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(normalized)) {
    return 'bad'
  }
  if (['INSPECTION', 'IN_TRANSIT', 'PICKED_UP', 'PENDING', 'OPEN', 'IN_PROGRESS'].includes(normalized)) {
    return 'warn'
  }
  return 'info'
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className={styles.state} role="status" aria-live="polite" aria-label={label}>
      <div className={styles.skeleton} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>{label}</p>
    </div>
  )
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className={styles.state}>
      <span className={styles.stateIcon} aria-hidden="true">
        <Inbox size={22} />
      </span>
      <h2>{title}</h2>
      <p>{body}</p>
      {action && <div className={styles.stateAction}>{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className={styles.state} role="alert">
      <span className={`${styles.stateIcon} ${styles.stateIconError}`} aria-hidden="true">
        <AlertCircle size={22} />
      </span>
      <h2>Something could not be loaded</h2>
      <p>{message}</p>
      {onRetry && (
        <div className={styles.stateAction}>
          <button type="button" className={styles.retryBtn} onClick={onRetry}>
            <RotateCcw size={15} aria-hidden="true" /> Try again
          </button>
        </div>
      )}
    </div>
  )
}

export function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) {
    return null
  }
  return (
    <p className={styles.fieldError} id={id} role="alert">
      {message}
    </p>
  )
}

export interface FilterChipOption<T extends string> {
  value: T;
  label: string;
  count: number;
}

/**
 * Shared filter/status chip row (My Returns, My Orders, …).
 *
 * One pill per option with a separate count badge; the active pill gets the
 * brand gradient + a springy pop. Visual/interaction layer only — filtering
 * logic and counts stay with the calling page. Renders the same
 * role="group" + aria-pressed semantics and 44px touch targets everywhere.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<FilterChipOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className={styles.filters} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`${styles.chip} ${value === option.value ? styles.chipActive : ''}`}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          <span className={styles.chipCount} aria-hidden="true">
            {option.count}
          </span>
        </button>
      ))}
    </div>
  )
}
