import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingBag } from 'lucide-react'
import { api, friendlyMessage } from '../../lib/api'
import type { OrderDetail, OrderRow } from '../../lib/api'
import { orderItemImageFor } from '../../lib/productImage'
import { EmptyState, ErrorState, FilterChips, LoadingState, PageHead, StatusBadge, statusTone } from '../../components/ui'
import styles from './orders.module.css'

// 1. IMPROVED: Better Currency Formatting
function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value)
}

// 2. IMPROVED: Clean Date Formatting (e.g., 24 Oct 2023)
function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(iso))
}

// 3. IMPROVED: Premium Product Display with Loading States & Stacked Images
function OrderProducts({ orderId }: { orderId: string }) {
  const [items, setItems] = useState<OrderDetail['items'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    
    api<OrderDetail>(`/orders/${orderId}`)
      .then((data) => {
        if (!cancelled) {
          setItems(data.items)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true)
          setLoading(false)
        }
      })
      
    return () => {
      cancelled = true
    }
  }, [orderId])

  if (loading) {
    return <span style={{ color: '#888', fontSize: '0.875rem', animation: 'pulse 1.5s infinite' }}>Loading items...</span>
  }

  if (error || !items) {
    return <span className={styles.ineligible} style={{ color: 'red' }}>Failed to load</span>
  }

  if (items.length === 0) {
    return <span className={styles.ineligible}>No items</span>
  }

  const firstItem = items[0]
  const extraCount = items.length - 1

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      {/* Visual Image/Avatar Group */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <img
          src={orderItemImageFor(firstItem)}
          alt={firstItem.product_name} 
          loading="lazy" 
          style={{ 
            width: '40px', 
            height: '40px', 
            objectFit: 'cover', 
            borderRadius: '6px',
            border: '1px solid #eaeaea',
            backgroundColor: '#f9f9f9',
            zIndex: 2,
            position: 'relative'
          }} 
        />
        {/* Agar aur items hain, toh ek stacked circle dikhayenge */}
        {extraCount > 0 && (
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            backgroundColor: '#f3f4f6',
            border: '2px solid white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.75rem',
            fontWeight: '600',
            color: '#555',
            marginLeft: '-12px',
            zIndex: 1,
            position: 'relative'
          }}>
            +{extraCount}
          </div>
        )}
      </div>

      {/* Product Names */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontWeight: 500, fontSize: '0.9rem', color: '#111' }}>
          {firstItem.product_name}
        </span>
        {extraCount > 0 && (
          <span style={{ fontSize: '0.75rem', color: '#666' }}>
            and {extraCount} other item{extraCount > 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  )
}

export default function Orders() {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [statusFilter, setStatusFilter] = useState('ALL')

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true)
      setError(null)
      try {
        const data = await api<{ orders: OrderRow[] }>('/orders')
        if (!cancelled) {
          // Sort orders by date descending (newest first)
          const sortedOrders = data.orders.sort((a, b) => 
            new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
          )
          setOrders(sortedOrders)
        }
      } catch (err) {
        if (!cancelled) {
          setError(friendlyMessage(err))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [attempt])

  const statuses = Array.from(new Set(orders.map((order) => order.status))).sort()
  const visible = statusFilter === 'ALL' ? orders : orders.filter((order) => order.status === statusFilter)

  const headActions = (
    <>
      <Link className={styles.shopLink} to="/customer/store" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <ShoppingBag size={16} aria-hidden="true" /> Shop Now
      </Link>
    </>
  )

  if (loading) {
    return (
      <div className={styles.page}>
        <PageHead kicker="Customer" title="My Orders" lede="Your purchase history and return eligibility." actions={headActions} />
        <LoadingState label="Loading your orders..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.page}>
        <PageHead kicker="Customer" title="My Orders" lede="Your purchase history and return eligibility." actions={headActions} />
        <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} />
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className={styles.page}>
        <PageHead kicker="Customer" title="My Orders" lede="Your purchase history and return eligibility." actions={headActions} />
        <EmptyState
          title="No orders yet"
          body="Orders you place will appear here. Browse our store to discover amazing products and get started."
          action={
            <Link className={styles.shopLink} to="/customer/store" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '6px', backgroundColor: '#000', color: '#fff', textDecoration: 'none' }}>
              <ShoppingBag size={18} aria-hidden="true" /> Start Shopping
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHead kicker="Customer" title="My Orders" lede="Select an order to check item eligibility and start a return." actions={headActions} />
      
      {statuses.length > 0 && (
        <FilterChips
          ariaLabel="Filter orders by status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'ALL', label: 'All', count: orders.length },
            ...statuses.map((status) => ({
              value: status,
              label: status,
              count: orders.filter((order) => order.status === status).length,
            })),
          ]}
        />
      )}

      {visible.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
          <p className={styles.helper} role="status" style={{ margin: 0, color: '#6b7280' }}>
            No orders match the "{statusFilter}" filter.
          </p>
          <button onClick={() => setStatusFilter('ALL')} style={{ marginTop: '12px', background: 'none', border: 'none', color: '#000', textDecoration: 'underline', cursor: 'pointer' }}>
            Clear filter
          </button>
        </div>
      ) : (
        <div className={styles.tableWrap} style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid #eaeaea' }}>
          <table className={styles.table} style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #eaeaea' }}>
              <tr>
                <th scope="col" style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Order ID</th>
                <th scope="col" style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Products</th>
                <th scope="col" style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Placed on</th>
                <th scope="col" style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Status</th>
                <th scope="col" style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Subtotal</th>
                <th scope="col" style={{ padding: '12px 16px', fontWeight: 600, color: '#374151' }}>Delivered</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((order) => (
                <tr key={order.id} style={{ borderBottom: '1px solid #eaeaea', transition: 'background-color 0.2s' }}>
                  <td style={{ padding: '16px' }}>
                    <Link className={styles.rowLink} to={`/customer/orders/${order.id}`} style={{ fontWeight: 600, textDecoration: 'none', color: '#2563eb' }}>
                      #{order.order_number}
                    </Link>
                  </td>
                  <td style={{ padding: '16px' }}>
                    <OrderProducts orderId={order.id} />
                  </td>
                  <td className={styles.mono} style={{ padding: '16px', color: '#4b5563', fontSize: '0.9rem' }}>
                    {formatDate(order.created_at)}
                  </td>
                  <td style={{ padding: '16px' }}>
                    <StatusBadge tone={statusTone(order.status)}>{order.status}</StatusBadge>
                  </td>
                  <td className={styles.mono} style={{ padding: '16px', fontWeight: 500 }}>
                    {formatMoney(order.subtotal)}
                  </td>
                  <td className={styles.mono} style={{ padding: '16px', color: '#4b5563', fontSize: '0.9rem' }}>
                    {formatDate(order.delivered_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}