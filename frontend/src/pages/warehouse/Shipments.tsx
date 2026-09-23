import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { wh } from '../../lib/warehouse'
import type { InboundShipment, ReceivingRecord } from '../../lib/warehouse'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge, statusTone } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from './ops.module.css'
import styles from './shipments.module.css'

const PAGE_SIZE = 25

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

export default function Shipments() {
  const [shipments, setShipments] = useState<InboundShipment[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [recent, setRecent] = useState<ReceivingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
        const data = await wh<{ shipments: InboundShipment[]; total: number; recentReceiving: ReceivingRecord[] }>(
          `/shipments?${params.toString()}`,
        )
        if (!cancelled) {
          setShipments(data.shipments)
          setTotal(data.total)
          setRecent(data.recentReceiving)
        }
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
  }, [offset, attempt])

  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Floor"
        title="Shipments"
        lede="Inbound return parcels from the system's own pickup records — no carrier tracking is invented here."
      />

      <section className={ops.panel} aria-label="Inbound shipments">
        <h2 className={ops.panelTitle}>Inbound shipments</h2>
        {loading ? (
          <LoadingState label="Loading shipments…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
        ) : shipments.length === 0 ? (
          <EmptyState title="No shipments" body="Pickup records appear here once returns are raised." />
        ) : (
          <>
            <div className={ops.tableWrap}>
              <table className={ops.table}>
                <thead>
                  <tr>
                    <th scope="col">Return</th>
                    <th scope="col">Tracking</th>
                    <th scope="col">Carrier</th>
                    <th scope="col">Pickup</th>
                    <th scope="col">Expected</th>
                    <th scope="col">Received</th>
                    <th scope="col">Return status</th>
                  </tr>
                </thead>
                <tbody>
                  {shipments.map((shipment, index) => (
                    <tr key={`${shipment.returnId}-${index}`}>
                      <td>
                        <Link className={ops.mono} to={`/warehouse/returns/${shipment.returnId}`}>
                          {shipment.returnNumber}
                        </Link>
                        <div className={ops.muted}>{shipment.orderNumber ?? ''}</div>
                      </td>
                      <td className={ops.mono}>{shipment.trackingNumber ?? '—'}</td>
                      <td>{shipment.carrier ?? '—'}</td>
                      <td>
                        <StatusBadge tone={statusTone(shipment.pickupStatus)}>
                          {shipment.pickupStatus.replaceAll('_', ' ')}
                        </StatusBadge>
                      </td>
                      <td className={ops.mono}>{formatDate(shipment.expectedArrival)}</td>
                      <td className={ops.mono}>{formatDate(shipment.receivedAt)}</td>
                      <td>
                        <StatusBadge tone={statusTone(shipment.returnStatus)}>
                          {shipment.returnStatus.replaceAll('_', ' ')}
                        </StatusBadge>
                      </td>
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

      <section className={ops.panel} aria-label="Recently received">
        <h2 className={ops.panelTitle}>Recently received</h2>
        {loading ? (
          <LoadingState label="Loading receiving records…" />
        ) : recent.length === 0 ? (
          <p className={ops.muted}>Nothing received yet.</p>
        ) : (
          <div className={ops.tableWrap}>
            <table className={ops.table}>
              <thead>
                <tr>
                  <th scope="col">Return</th>
                  <th scope="col">Received</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Condition</th>
                  <th scope="col">Discrepancy</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <Link className={ops.mono} to={`/warehouse/returns/${record.return_id}`}>
                        {record.return_id.slice(0, 8)}…
                      </Link>
                      <div className={ops.muted}>{record.tracking_number ?? ''}</div>
                    </td>
                    <td className={ops.mono}>{formatDate(record.created_at)}</td>
                    <td className={ops.mono}>
                      {record.received_quantity}/{record.expected_quantity}
                    </td>
                    <td className={ops.mono}>{record.package_condition.replaceAll('_', ' ')}</td>
                    <td>
                      {record.discrepancy === 'NONE' ? (
                        <span className={ops.muted}>NONE</span>
                      ) : (
                        <span className={ops.flagOverdue}>{record.discrepancy.replaceAll('_', ' ')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
