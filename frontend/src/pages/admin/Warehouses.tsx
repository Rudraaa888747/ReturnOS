import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ad } from '../../lib/admin'
import type { AdminWarehouse } from '../../lib/admin'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

export default function Warehouses() {
  const [rows, setRows] = useState<AdminWarehouse[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true)
      setError(null)
      try {
        const data = await ad<{ warehouses: AdminWarehouse[] }>('/warehouses')
        if (!cancelled) setRows(data.warehouses)
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

  return (
    <div className={styles.page}>
      <PageHead kicker="Admin" title="Warehouses" lede="Every site with live workload, operators and inventory rollups." />

      {loading ? (
        <LoadingState label="Loading warehouses…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
      ) : rows.length === 0 ? (
        <EmptyState title="No warehouses" body="No warehouse sites are configured." />
      ) : (
        <div className={ops.tableWrap}>
          <table className={ops.table}>
            <thead>
              <tr>
                <th scope="col">Site</th>
                <th scope="col">Status</th>
                <th scope="col">Operators</th>
                <th scope="col">Open tasks</th>
                <th scope="col">Pending returns</th>
                <th scope="col">Inventory units</th>
                <th scope="col">Resolved 30d</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link to={`/admin/warehouses/${row.id}`}>
                      {row.code} · {row.name}
                    </Link>
                    <div className={ops.muted}>{row.city}</div>
                  </td>
                  <td>
                    <StatusBadge tone={row.active === 1 ? 'ok' : 'bad'}>{row.active === 1 ? 'Active' : 'Disabled'}</StatusBadge>
                  </td>
                  <td className={ops.mono}>{row.operators}</td>
                  <td className={ops.mono}>{row.open_tasks}</td>
                  <td className={ops.mono}>{row.pending_returns}</td>
                  <td className={ops.mono}>{row.inventory_units}</td>
                  <td className={ops.mono}>{row.resolved_30d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
