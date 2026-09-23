import { useEffect, useState } from 'react'
import { ad } from '../../lib/admin'
import { warningLabel } from '../../lib/warehouse'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

function formatMoneyPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

interface GlobalAnalytics {
  scope: string;
  windowDays: number;
  commerce: { orders: number; revenuePaise: number; averageOrderPaise: number | null; byStatus: Array<{ status: string; count: number }> };
  returns: {
    volume: number;
    rate: number | null;
    byReason: Array<{ reason: string; count: number }>;
    byResolution: Array<{ resolution: string | null; count: number }>;
    averageReceiveToResolutionHours: number | null;
  };
  refunds: { count: number; amountPaise: number; pending: number };
  credit: { issuedPaise: number; usedPaise: number; outstandingPaise: number };
  inventory: { available: number; returned: number; damaged: number; restockedUnits: number; movements: number };
  warehouse: {
    averageReceiveToInspectionHours: number | null;
    averageInspectionMinutes: number | null;
    pendingWorkload: number;
    overdueTasks: number;
  };
  recovery: { valuePaise: number; byAction: Array<{ action: string; count: number; quantity: number }> };
  customers: { newCustomers: number; activeCustomers: number; ordersPerCustomer: number | null; returnsActive: number };
  warnings: Array<{ action: string; count: number }>;
  byWarehouse: Array<{ warehouseId: string; code: string; returns: number; tasks: number; inventoryUnits: number }>;
}

const WINDOWS = [7, 30, 90] as const

export default function Analytics() {
  const [windowDays, setWindowDays] = useState<number>(30)
  const [data, setData] = useState<GlobalAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true)
      setError(null)
      try {
        const result = await ad<GlobalAnalytics>(`/analytics?windowDays=${windowDays}`)
        if (!cancelled) setData(result)
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
  }, [windowDays, attempt])

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Admin"
        title="Analytics"
        lede="Platform-wide aggregates computed live. Averages say “no data yet” instead of inventing a zero."
        actions={
          <label className={styles.filterWrap}>
            <span className={styles.filterLabel}>Window</span>
            <select
              className={styles.filterSelect}
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
        <LoadingState label="Crunching platform numbers…" />
      ) : error || !data ? (
        <ErrorState message={error ?? 'Analytics could not be loaded.'} onRetry={() => setAttempt((v) => v + 1)} />
      ) : (
        <>
          <section aria-label="Headline metrics">
            <ul className={styles.stats}>
              <Metric label="Orders" value={String(data.commerce.orders)} />
              <Metric label="Revenue" value={formatMoneyPaise(data.commerce.revenuePaise)} />
              <Metric label="Avg order" value={data.commerce.averageOrderPaise === null ? '—' : formatMoneyPaise(data.commerce.averageOrderPaise)} />
              <Metric label="Returns" value={String(data.returns.volume)} />
              <Metric label="Return rate" value={data.returns.rate === null ? '—' : String(data.returns.rate)} />
              <Metric label="Refunds paid" value={formatMoneyPaise(data.refunds.amountPaise)} />
              <Metric label="Credit outstanding" value={formatMoneyPaise(data.credit.outstandingPaise)} />
              <Metric label="Recovery value" value={formatMoneyPaise(data.recovery.valuePaise)} />
            </ul>
          </section>

          <div className={styles.twoCol}>
            <section className={ops.panel} aria-label="Order status mix">
              <h2 className={ops.panelTitle}>Orders by status</h2>
              <Breakdown
                rows={data.commerce.byStatus.map((row) => [row.status.replaceAll('_', ' '), String(row.count)])}
                empty="No orders in this window."
              />
            </section>
            <section className={ops.panel} aria-label="Resolution mix">
              <h2 className={ops.panelTitle}>Returns by resolution</h2>
              <Breakdown
                rows={data.returns.byResolution.map((row) => [String(row.resolution ?? '—').replaceAll('_', ' '), String(row.count)])}
                empty="No returns in this window."
              />
            </section>
          </div>

          <div className={styles.twoCol}>
            <section className={ops.panel} aria-label="Reasons">
              <h2 className={ops.panelTitle}>Returns by reason</h2>
              <Breakdown
                rows={data.returns.byReason.map((row) => [row.reason.replaceAll('_', ' '), String(row.count)])}
                empty="No returns in this window."
              />
            </section>
            <section className={ops.panel} aria-label="Recovery">
              <h2 className={ops.panelTitle}>Recovery by action</h2>
              <Breakdown
                rows={data.recovery.byAction.map((row) => [`${row.action.replaceAll('_', ' ')} · ${row.quantity} units`, String(row.count)])}
                empty="No dispositions in this window."
              />
            </section>
          </div>

          <section className={ops.panel} aria-label="Sites">
            <h2 className={ops.panelTitle}>By warehouse</h2>
            {data.byWarehouse.length === 0 ? (
              <p className={ops.muted}>No warehouses.</p>
            ) : (
              <div className={ops.tableWrap}>
                <table className={ops.table}>
                  <thead>
                    <tr>
                      <th scope="col">Site</th>
                      <th scope="col">Returns</th>
                      <th scope="col">Tasks</th>
                      <th scope="col">Inventory units</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byWarehouse.map((site) => (
                      <tr key={site.warehouseId}>
                        <td className={ops.mono}>{site.code}</td>
                        <td className={ops.mono}>{site.returns}</td>
                        <td className={ops.mono}>{site.tasks}</td>
                        <td className={ops.mono}>{site.inventoryUnits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={ops.panel} aria-label="Warnings">
            <h2 className={ops.panelTitle}>Warnings</h2>
            {data.warnings.length === 0 ? (
              <p className={ops.muted}>No warnings in this window.</p>
            ) : (
              <ul className={styles.plainList}>
                {data.warnings.map((warning) => (
                  <li key={warning.action}>
                    <StatusBadge tone="warn">{warning.count}</StatusBadge> {warningLabel(warning.action)}{' '}
                    <span className={ops.muted}>{warning.action}</span>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <li className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </li>
  )
}

function Breakdown({ rows, empty }: { rows: string[][]; empty: string }) {
  if (rows.length === 0) {
    return <EmptyState title="Nothing here" body={empty} />
  }
  return (
    <ul className={styles.plainList}>
      {rows.map((row, index) => (
        <li key={index}>
          {row[0]} <span className={ops.muted}>· {row[1]}</span>
        </li>
      ))}
    </ul>
  )
}
