import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ad } from '../../lib/admin'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

const PAGE_SIZE = 25

function formatMoneyPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

interface LedgerEntry {
  id: string;
  user_email: string;
  type: string;
  amount_paise: number;
  reason: string | null;
  reference_type: string;
  reference_id: string;
  created_at: string;
}

interface Balance {
  user_id: string;
  user_email: string;
  balance_paise: number;
}

export default function Credit() {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [balances, setBalances] = useState<Balance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const [lookupEmail, setLookupEmail] = useState('')
  const [lookupId, setLookupId] = useState<string | null>(null)
  const [lookupBalance, setLookupBalance] = useState<number | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT')
  const [amountRupees, setAmountRupees] = useState('')
  const [reason, setReason] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const [adjustError, setAdjustError] = useState<string | null>(null)
  const [adjustOk, setAdjustOk] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true)
      setError(null)
      try {
        const [ledger, top] = await Promise.all([
          ad<{ entries: LedgerEntry[]; total: number }>(`/credit/ledger?limit=${PAGE_SIZE}&offset=${offset}`),
          ad<{ balances: Balance[] }>('/credit/balances?limit=10'),
        ])
        if (!cancelled) {
          setEntries(ledger.entries)
          setTotal(ledger.total)
          setBalances(top.balances)
        }
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 403) {
            setError('This account is not an admin.')
          } else {
            setError(friendlyMessage(err))
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [offset, attempt])

  async function lookup(event: FormEvent): Promise<void> {
    event.preventDefault()
    setLookupError(null)
    setLookupId(null)
    setLookupBalance(null)
    try {
      const data = await ad<{ customers: Array<{ id: string; email: string }> }>(
        `/customers?search=${encodeURIComponent(lookupEmail.trim())}`,
      )
      const match = data.customers.find((row) => row.email.toLowerCase() === lookupEmail.trim().toLowerCase())
      if (!match) {
        setLookupError('No customer with that email.')
        return
      }
      setLookupId(match.id)
      const detail = await ad<{ credit: { balancePaise: number } }>(`/customers/${match.id}`)
      setLookupBalance(detail.credit.balancePaise)
    } catch (err) {
      setLookupError(friendlyMessage(err))
    }
  }

  async function adjust(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!lookupId) {
      setAdjustError('Look up the customer first.')
      return
    }
    const paise = Math.round(Number(amountRupees) * 100)
    if (!Number.isFinite(paise) || paise <= 0) {
      setAdjustError('Amount must be a positive rupee figure.')
      return
    }
    if (reason.trim().length < 8) {
      setAdjustError('A justification of at least 8 characters is required — no reason, no adjustment.')
      return
    }
    setAdjusting(true)
    setAdjustError(null)
    setAdjustOk(false)
    try {
      const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `adj-${Date.now()}`;
      await ad('/credit/adjustments', {
        method: 'POST',
        body: { userId: lookupId, direction, amountPaise: paise, reason: reason.trim(), key },
      });
      setAdjustOk(true)
      setAmountRupees('')
      setReason('')
      setAttempt((v) => v + 1)
      const detail = await ad<{ credit: { balancePaise: number } }>(`/customers/${lookupId}`)
      setLookupBalance(detail.credit.balancePaise)
    } catch (err) {
      setAdjustError(friendlyMessage(err))
    } finally {
      setAdjusting(false)
    }
  }

  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Admin"
        title="Store Credit"
        lede="Every balance move is a ledger entry with a recorded reason. Adjustments are audited with before/after balances."
      />

      <section className={ops.panel} aria-label="Adjust credit">
        <h2 className={ops.panelTitle}>Adjust a balance</h2>
        <form onSubmit={(event) => void lookup(event)}>
          <div className={ops.formGrid}>
            <label className={ops.field}>
              <span className={ops.label}>Customer email</span>
              <input
                className={ops.input}
                type="email"
                value={lookupEmail}
                onChange={(event) => setLookupEmail(event.target.value)}
                placeholder="customer@example.com"
              />
            </label>
            <div className={ops.field} style={{ justifyContent: 'flex-end' }}>
              <button type="submit" className={ops.btn}>
                Look up
              </button>
            </div>
          </div>
        </form>
        {lookupError && (
          <p className={styles.inlineError} role="alert">
            {lookupError}
          </p>
        )}
        {lookupId && lookupBalance !== null && (
          <form onSubmit={(event) => void adjust(event)}>
            <p>
              Balance: <strong className={ops.mono}>{formatMoneyPaise(lookupBalance)}</strong>
            </p>
            <div className={ops.formGrid}>
              <label className={ops.field}>
                <span className={ops.label}>Direction</span>
                <select
                  className={ops.select}
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as 'CREDIT' | 'DEBIT')}
                >
                  <option value="CREDIT">Credit (add)</option>
                  <option value="DEBIT">Debit (remove)</option>
                </select>
              </label>
              <label className={ops.field}>
                <span className={ops.label}>Amount (₹)</span>
                <input
                  className={ops.input}
                  type="number"
                  min={0}
                  step="0.01"
                  value={amountRupees}
                  onChange={(event) => setAmountRupees(event.target.value)}
                />
              </label>
              <label className={`${ops.field} ${ops.fieldFull}`}>
                <span className={ops.label}>Justification (required, min 8 chars)</span>
                <textarea
                  className={ops.textarea}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                  maxLength={2000}
                />
              </label>
            </div>
            {adjustError && (
              <p className={styles.inlineError} role="alert">
                {adjustError}
              </p>
            )}
            {adjustOk && (
              <p className={styles.inlineOk} role="status">
                Adjustment recorded in the ledger and the audit trail.
              </p>
            )}
            <div className={ops.btnRow}>
              <button type="submit" className={`${ops.btn} ${ops.btnPrimary}`} disabled={adjusting}>
                {adjusting ? 'Recording…' : 'Record adjustment'}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className={ops.panel} aria-label="Largest balances">
        <h2 className={ops.panelTitle}>Largest balances</h2>
        {balances.length === 0 ? (
          <p className={ops.muted}>No non-zero balances.</p>
        ) : (
          <ul className={styles.plainList}>
            {balances.map((row) => (
              <li key={row.user_id}>
                <span className={ops.mono}>{formatMoneyPaise(row.balance_paise)}</span>{' '}
                <span className={ops.muted}>{row.user_email}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={ops.panel} aria-label="Ledger">
        <h2 className={ops.panelTitle}>Ledger ({total})</h2>
        {loading ? (
          <LoadingState label="Loading ledger…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
        ) : entries.length === 0 ? (
          <EmptyState title="No entries" body="No ledger entries recorded." />
        ) : (
          <>
            <div className={ops.tableWrap}>
              <table className={ops.table}>
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col">Type</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Reference</th>
                    <th scope="col">At</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className={ops.mono}>{entry.user_email}</td>
                      <td>
                        <StatusBadge tone={entry.type === 'CREDIT' ? 'ok' : entry.type === 'DEBIT' ? 'warn' : 'info'}>
                          {entry.type.replaceAll('_', ' ')}
                        </StatusBadge>
                      </td>
                      <td className={ops.mono}>{formatMoneyPaise(entry.amount_paise)}</td>
                      <td>{entry.reason ?? '—'}</td>
                      <td className={ops.mono}>
                        {entry.reference_type} · {entry.reference_id.slice(0, 8)}…
                      </td>
                      <td className={ops.mono}>{formatDate(entry.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.pager}>
              <span className={ops.muted} role="status">
                Showing {from}–{to} of {total}
              </span>
              <span className={styles.pagerBtns}>
                <button
                  type="button"
                  className={styles.pagerBtn}
                  disabled={offset === 0}
                  onClick={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))}
                >
                  ← Prev
                </button>
                <button
                  type="button"
                  className={styles.pagerBtn}
                  disabled={to >= total}
                  onClick={() => setOffset((v) => v + PAGE_SIZE)}
                >
                  Next →
                </button>
              </span>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
