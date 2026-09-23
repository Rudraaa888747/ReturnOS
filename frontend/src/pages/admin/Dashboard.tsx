import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ad } from '../../lib/admin'
import type { DashboardSummary } from '../../lib/admin'
import { ErrorState, LoadingState, PageHead, StatusBadge } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

function formatMoneyPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

interface Tile {
  label: string
  value: string
  to?: string
  alert?: boolean
}

export default function AdminDashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true)
      setError(null)
      try {
        const data = await ad<DashboardSummary>('/summary')
        if (!cancelled) setSummary(data)
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
  }, [attempt])

  if (loading) {
    return (
      <div>
        <PageHead kicker="Admin" title="Dashboard" lede="Live platform state, derived from real rows." />
        <LoadingState label="Loading platform summary…" />
      </div>
    )
  }

  if (error || !summary) {
    return (
      <div>
        <PageHead kicker="Admin" title="Dashboard" lede="Live platform state, derived from real rows." />
        <ErrorState message={error ?? 'Summary could not be loaded.'} onRetry={() => setAttempt((v) => v + 1)} />
      </div>
    )
  }

  const tiles: Tile[] = [
    { label: 'Total orders', value: String(summary.commerce.totalOrders), to: '/admin/orders' },
    { label: 'Orders today', value: String(summary.commerce.ordersToday), to: '/admin/orders' },
    { label: 'Pending orders', value: String(summary.commerce.pendingOrders), to: '/admin/orders' },
    { label: 'Total returns', value: String(summary.returns.totalReturns), to: '/admin/returns' },
    { label: 'New returns', value: String(summary.returns.newReturns), to: '/admin/returns' },
    { label: 'Pending receiving', value: String(summary.returns.pendingReceiving), to: '/admin/returns' },
    { label: 'Pending inspection', value: String(summary.returns.pendingInspection), to: '/admin/returns' },
    { label: 'Pending disposition', value: String(summary.returns.pendingDisposition), to: '/admin/returns' },
    { label: 'Refunds pending', value: String(summary.financial.refundsPending), to: '/admin/refunds' },
    {
      label: 'Refunds completed',
      value: `${summary.financial.refundsCompleted} · ${formatMoneyPaise(summary.financial.refundsCompletedPaise)}`,
      to: '/admin/refunds',
    },
    {
      label: 'Credit issued',
      value: formatMoneyPaise(summary.financial.creditIssuedPaise),
      to: '/admin/credit',
    },
    {
      label: 'Credit used',
      value: formatMoneyPaise(summary.financial.creditUsedPaise),
      to: '/admin/credit',
    },
    { label: 'Pending tasks', value: String(summary.warehouse.pendingTasks), to: '/admin/workload' },
    {
      label: 'Overdue tasks',
      value: String(summary.warehouse.overdueTasks),
      to: '/admin/workload',
      alert: summary.warehouse.overdueTasks > 0,
    },
    { label: 'Total customers', value: String(summary.customers.totalCustomers), to: '/admin/customers' },
    { label: 'Recovered value', value: formatMoneyPaise(summary.recovery.recoveredValuePaise) },
  ]

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Admin"
        title="Dashboard"
        lede="Live platform state, derived from real rows — never hardcoded."
      />

      <section aria-label="Platform metrics">
        <ul className={styles.stats}>
          {tiles.map((tile) => (
            <li key={tile.label} className={`${styles.stat} ${tile.alert ? styles.statAlert : ''}`}>
              <span className={styles.statValue}>{tile.value}</span>
              {tile.to ? (
                <Link className={styles.statLabel} to={tile.to}>
                  {tile.label}
                </Link>
              ) : (
                <span className={styles.statLabel}>{tile.label}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div className={styles.twoCol}>
        <section className={ops.panel} aria-label="Needs attention">
          <h2 className={ops.panelTitle}>Needs attention</h2>
          {summary.overdueTasksList.length === 0 &&
          summary.pendingRefunds.length === 0 &&
          summary.warehouseAlerts.length === 0 &&
          summary.openTickets.length === 0 ? (
            <p className={ops.muted}>Nothing urgent. The floor is clear.</p>
          ) : (
            <ul className={styles.attentionList}>
              {summary.overdueTasksList.map((task) => (
                <li key={task.id}>
                  <StatusBadge tone="bad">Overdue</StatusBadge> {task.title}
                </li>
              ))}
              {summary.pendingRefunds.map((refund) => (
                <li key={refund.id}>
                  <Link to="/admin/refunds">
                    Refund {formatMoneyPaise(refund.amount_paise)} pending
                  </Link>{' '}
                  · {refund.return_number}
                </li>
              ))}
              {summary.warehouseAlerts.map((warning) => (
                <li key={warning.action}>
                  <StatusBadge tone="warn">{warning.count}</StatusBadge> {warning.action.replaceAll('_', ' ')}
                </li>
              ))}
              {summary.openTickets.map((ticket) => (
                <li key={ticket.id}>
                  <Link to={`/admin/support/${ticket.id}`}>
                    {ticket.ticket_number}: {ticket.subject}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={ops.panel} aria-label="Recent activity">
          <h2 className={ops.panelTitle}>Recent activity</h2>
          <ul className={styles.attentionList}>
            {summary.recentOrders.map((order) => (
              <li key={order.id}>
                <Link className={ops.mono} to={`/admin/orders/${order.id}`}>
                  {order.order_number}
                </Link>{' '}
                · {order.status.replaceAll('_', ' ')}
              </li>
            ))}
            {summary.recentReturns.map((ret) => (
              <li key={ret.id}>
                <Link className={ops.mono} to={`/admin/returns/${ret.id}`}>
                  {ret.return_number}
                </Link>{' '}
                · {ret.status.replaceAll('_', ' ')}
              </li>
            ))}
            {summary.recentAdminActivity.map((entry) => (
              <li key={entry.id}>
                <span className={ops.mono}>{entry.action}</span> · {entry.entity_type}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
