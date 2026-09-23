import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { wh, warningLabel } from '../../lib/warehouse'
import type { WarehouseAnalytics } from '../../lib/warehouse'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from './ops.module.css'
import styles from './analytics.module.css'

const WINDOWS = [7, 30, 90] as const

function formatHours(value: number | null, unit: 'h' | 'min'): string {
  if (value === null || !Number.isFinite(value)) return 'No data yet'
  return `${value.toFixed(1)}${unit}`
}

function formatMoneyPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

export default function Analytics() {
  const [windowDays, setWindowDays] = useState<number>(30)
  const [data, setData] = useState<WarehouseAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true)
      setError(null)
      try {
        const result = await wh<WarehouseAnalytics>(`/analytics?windowDays=${windowDays}`)
        if (!cancelled) setData(result)
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 403) {
            setError('This account is not assigned to a warehouse.')
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
  }, [windowDays, attempt])

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Floor"
        title="Analytics"
        lede="Aggregates over rows the floor actually wrote. Averages say “no data yet” instead of inventing a zero."
        actions={
          <label className={styles.windowWrap}>
            <span className={styles.windowLabel}>Window</span>
            <select
              className={styles.windowSelect}
              value={windowDays}
              onChange={(event) => setWindowDays(Number(event.target.value))}
              aria-label="Analytics window in days"
            >
              {WINDOWS.map((days) => (
                <option key={days} value={days}>
                  Last {days} days
                </option>
              ))}
            </select>
          </label>
        }
      />

      {loading ? (
        <LoadingState label="Crunching floor numbers…" />
      ) : error || !data ? (
        <ErrorState message={error ?? 'Analytics could not be loaded.'} onRetry={() => setAttempt((v) => v + 1)} />
      ) : (
        <>
          <section aria-label="Throughput">
            <ul className={styles.stats}>
              <Metric label="Returns received" value={String(data.returnsReceived)} />
              <Metric label="Inspections completed" value={String(data.inspectionsCompleted)} />
              <Metric label="Pending inspection" value={String(data.pendingInspection)} />
              <Metric label="Pending disposition" value={String(data.pendingDisposition)} />
              <Metric label="Restocked units" value={String(data.restockedUnits)} />
              <Metric label="Damaged units" value={String(data.damagedUnits)} />
              <Metric label="Recovery value" value={formatMoneyPaise(data.recoveryValuePaise)} />
              <Metric label="Overdue tasks" value={String(data.overdueTasks)} alert={data.overdueTasks > 0} />
            </ul>
          </section>

          <section className={ops.panel} aria-label="Cycle times">
            <h2 className={ops.panelTitle}>Cycle times</h2>
            <ul className={styles.cycles}>
              <li>
                <span className={styles.cycleValue}>{formatHours(data.averageReceiveToInspectionHours, 'h')}</span>
                <span className={styles.cycleLabel}>Receive → inspection</span>
              </li>
              <li>
                <span className={styles.cycleValue}>{formatHours(data.averageInspectionMinutes, 'min')}</span>
                <span className={styles.cycleLabel}>Inspection duration</span>
              </li>
              <li>
                <span className={styles.cycleValue}>{formatHours(data.averageReceiveToResolutionHours, 'h')}</span>
                <span className={styles.cycleLabel}>Receive → resolution</span>
              </li>
            </ul>
          </section>

          <div className={styles.twoCol}>
            <section className={ops.panel} aria-label="Dispositions by action">
              <h2 className={ops.panelTitle}>Dispositions by action</h2>
              {data.dispositionsByAction.length === 0 ? (
                <EmptyState title="No dispositions" body="Nothing dispositioned in this window." />
              ) : (
                <BreakdownTable
                  head={['Action', 'Lines', 'Units']}
                  rows={data.dispositionsByAction.map((row) => [row.action.replaceAll('_', ' '), String(row.count), String(row.quantity)])}
                />
              )}
            </section>

            <section className={ops.panel} aria-label="Inspections by result">
              <h2 className={ops.panelTitle}>Inspections by result</h2>
              {data.inspectionsByResult.length === 0 ? (
                <EmptyState title="No inspections" body="Nothing inspected in this window." />
              ) : (
                <BreakdownTable
                  head={['Result', 'Lines']}
                  rows={data.inspectionsByResult.map((row) => [row.result.replaceAll('_', ' '), String(row.count)])}
                />
              )}
            </section>
          </div>

          <section className={ops.panel} aria-label="Movements by reason">
            <h2 className={ops.panelTitle}>Movements by reason</h2>
            {data.movementsByReason.length === 0 ? (
              <p className={ops.muted}>No stock movements in this window.</p>
            ) : (
              <BreakdownTable
                head={['Reason', 'Moves', 'Units']}
                rows={data.movementsByReason.map((row) => [row.reason.replaceAll('_', ' '), String(row.count), String(row.quantity)])}
              />
            )}
          </section>

          <section className={ops.panel} aria-label="Warnings">
            <h2 className={ops.panelTitle}>
              <AlertTriangle size={15} aria-hidden="true" /> Warnings
            </h2>
            {data.warnings.length === 0 ? (
              <p className={ops.muted}>No warnings in this window.</p>
            ) : (
              <ul className={styles.warnList}>
                {data.warnings.map((warning) => (
                  <li key={warning.action} className={styles.warnRow}>
                    <StatusBadge tone="warn">{warning.count}</StatusBadge>
                    <span>{warningLabel(warning.action)}</span>
                    <code className={ops.mono}>{warning.action}</code>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function Metric({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <li className={`${styles.stat} ${alert ? styles.statAlert : ''}`}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </li>
  )
}

function BreakdownTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className={ops.tableWrap}>
      <table className={ops.table}>
        <thead>
          <tr>
            {head.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={cellIndex === 0 ? undefined : ops.mono}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
