import { useState } from 'react'
import { useAsync } from '../../hooks/useAsync'
import { errorMessage } from '../../lib/api'
import { dateOnly, money } from '../../lib/format'
import { listOrders, markDelivered } from '../../services/catalog'
import {
  Button,
  EmptyState,
  Field,
  LoadError,
  PageHead,
  Pagination,
  SelectInput,
  Skeleton,
} from '../../components/ui'
import ui from '../../components/ui.module.css'
import { ConfirmDialog, useToast } from '../../components/feedback'
import { OrderBadge } from '../../components/status'
import type { OrderStatus } from '../../lib/types'

export default function OrdersList() {
  const notify = useToast()
  const [status, setStatus] = useState<'' | OrderStatus>('')
  const [page, setPage] = useState(0)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { data, error, loading, reload } = useAsync(() => listOrders(page, 12), [page])

  const visible = (data?.content ?? []).filter((o) => (status ? o.status === status : true))

  const deliver = async () => {
    if (!confirming || busy) return
    const id = confirming
    setBusy(true)
    try {
      const updated = await markDelivered(id)
      notify(`Order ${updated.orderNumber} marked delivered.`)
      reload()
    } catch (err) {
      notify(errorMessage(err), 'error')
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  return (
    <>
      <PageHead
        title="Orders"
        intro="Every customer order, oldest first. Delivering an order makes it eligible for returns."
      />
      <div className={ui.toolbar}>
        <Field label="Status" htmlFor="ord-status">
          <SelectInput
            id="ord-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as '' | OrderStatus)
              setPage(0)
            }}
          >
            <option value="">Placed + delivered</option>
            <option value="PLACED">Placed</option>
            <option value="DELIVERED">Delivered</option>
          </SelectInput>
        </Field>
      </div>

      {loading && (
        <>
          <Skeleton height={52} />
          <div style={{ height: 'var(--sp-2)' }} />
          <Skeleton height={52} />
        </>
      )}
      {error && <LoadError error={error} onRetry={reload} />}
      {data && status && (
        <p className="meta" role="status" style={{ marginBottom: 'var(--sp-3)' }}>
          Showing {visible.length} of {data.content.length} orders on this page — clear the filter to page through all{' '}
          {data.totalElements} orders.
        </p>
      )}
      {data && visible.length === 0 && (
        <EmptyState
          title={status ? 'No orders with this status' : 'No orders yet'}
          body={
            status
              ? 'Try the other status filter.'
              : 'Orders placed by customers appear here for delivery.'
          }
        />
      )}
      {data && visible.length > 0 && (
        <>
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                Customer orders
              </caption>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Items</th>
                  <th scope="col">Total</th>
                  <th scope="col">Placed</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((o) => (
                  <tr key={o.id}>
                    <td data-th="Order" className="data">
                      {o.orderNumber}
                    </td>
                    <td data-th="Items">{o.items.reduce((n, i) => n + i.quantity, 0)}</td>
                    <td data-th="Total" className="data">
                      {money(o.subtotal)}
                    </td>
                    <td data-th="Placed" className="data">
                      {dateOnly(o.createdAt)}
                    </td>
                    <td data-th="Status">
                      <OrderBadge status={o.status} />
                    </td>
                    <td data-th="Action">
                      {o.status === 'PLACED' && (
                        <Button size="sm" variant="primary" disabled={busy} onClick={() => setConfirming(o.id)}>
                          Mark delivered
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!status && (
            <Pagination
              page={data.number}
              totalPages={data.totalPages}
              totalElements={data.totalElements}
              onPage={setPage}
              label={data.totalElements === 1 ? 'order' : 'orders'}
            />
          )}
        </>
      )}
      <ConfirmDialog
        open={confirming !== null}
        title="Mark this order as delivered?"
        body="Delivery makes the order eligible for returns. Only confirm when the goods reached the customer."
        confirmLabel="Mark delivered"
        busy={busy}
        onClose={() => setConfirming(null)}
        onConfirm={() => void deliver()}
      />
    </>
  )
}
