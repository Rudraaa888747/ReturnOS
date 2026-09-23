import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, CheckCheck, LifeBuoy, PackageSearch, Plus, RotateCcw, ShoppingBag } from 'lucide-react'
import { api, friendlyMessage } from '../../lib/api'
import type { NotificationRow, OrderRow, PublicUser, ReturnRow } from '../../lib/api'
import { EmptyState, ErrorState, LoadingState, PageHead, StatusBadge, statusTone } from '../../components/ui'
import styles from './dashboard.module.css'

const CLOSED_STATUSES = new Set(['COMPLETED', 'CANCELLED', 'REJECTED'])

interface ProfileResponse {
  user: PublicUser
}

function firstName(fullName: string | undefined): string | null {
  if (!fullName) return null
  const first = fullName.trim().split(/\s+/)[0]
  return first ? first : null
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

export default function Dashboard() {
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [returns, setReturns] = useState<ReturnRow[]>([])
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    async function load(): Promise<void> {
      setLoading(true)
      setError(null)
      try {
        const [ordersRes, returnsRes, notifRes] = await Promise.all([
          api<{ orders: OrderRow[] }>('/orders', { signal: controller.signal }),
          api<{ returns: ReturnRow[] }>('/returns', { signal: controller.signal }),
          api<{ notifications: NotificationRow[] }>('/notifications?unreadOnly=true', {
            signal: controller.signal,
          }),
        ])
        // Profile is best-effort: the dashboard must render even when it fails.
        try {
          const profileRes = await api<ProfileResponse>('/profile', { signal: controller.signal })
          if (!cancelled) {
            setDisplayName(firstName(profileRes.user.fullName))
          }
        } catch {
          if (!cancelled) {
            setDisplayName(null)
          }
        }
        if (!cancelled) {
          setOrders(ordersRes.orders)
          setReturns(returnsRes.returns)
          setNotifications(notifRes.notifications)
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
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
      controller.abort()
    }
  }, [attempt])

  async function markAsRead(id: string): Promise<void> {
    setMarkingId(id)
    try {
      await api<{ message: string }>(`/notifications/${id}/read`, { method: 'POST' })
      setNotifications((prev) => prev.filter((item) => item.id !== id))
    } catch {
      // Keep the notification visible; the list is non-critical.
    } finally {
      setMarkingId(null)
    }
  }

  if (loading) {
    return (
      <div>
        <PageHead kicker="Customer" title="Dashboard" lede="Loading your returns overview." />
        <LoadingState label="Loading dashboard" />
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <PageHead kicker="Customer" title="Dashboard" lede="Your returns at a glance." />
        <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} />
      </div>
    )
  }

  const activeReturns = returns.filter((item) => !CLOSED_STATUSES.has(item.status.toUpperCase()))
  const completedReturns = returns.filter((item) => item.status.toUpperCase() === 'COMPLETED')
  const topActive = activeReturns.slice(0, 4)
  const topUpdates = notifications.slice(0, 5)

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Customer"
        title={displayName ? `Welcome back, ${displayName}` : 'Welcome back'}
        lede="Track active returns, start a new request, and catch up on important updates."
      />

      <section className={styles.grid} aria-label="Summary">
        <div className={styles.card}>
          <div className={styles.cardTop}>
            <span className={styles.cardIcon} aria-hidden="true">
              <RotateCcw size={17} />
            </span>
          </div>
          <span className={styles.cardValue}>{activeReturns.length}</span>
          <span className={styles.cardLabel}>Active returns</span>
          <span className={styles.cardSub}>Awaiting pickup, transit, or review</span>
        </div>
        <div className={styles.card}>
          <div className={styles.cardTop}>
            <span className={styles.cardIcon} aria-hidden="true">
              <CheckCheck size={17} />
            </span>
          </div>
          <span className={styles.cardValue}>{completedReturns.length}</span>
          <span className={styles.cardLabel}>Completed recently</span>
          <span className={styles.cardSub}>Returns with completed status</span>
        </div>
        <div className={styles.card}>
          <div className={styles.cardTop}>
            <span className={styles.cardIcon} aria-hidden="true">
              <ShoppingBag size={17} />
            </span>
          </div>
          <span className={styles.cardValue}>{orders.length}</span>
          <span className={styles.cardLabel}>Orders</span>
          <span className={styles.cardSub}>Eligible for new return requests</span>
        </div>
        <div className={styles.card}>
          <div className={styles.cardTop}>
            <span className={styles.cardIcon} aria-hidden="true">
              <Bell size={17} />
            </span>
          </div>
          <span className={styles.cardValue}>{notifications.length}</span>
          <span className={styles.cardLabel}>Unread updates</span>
          <span className={styles.cardSub}>Notifications waiting for you</span>
        </div>
      </section>

      <div className={styles.columns}>
        <section className={styles.panel} aria-labelledby="active-returns-h">
          <div className={styles.panelHead}>
            <h2 id="active-returns-h">Active returns</h2>
            <Link className={styles.panelLink} to="/customer/returns">
              View all returns
            </Link>
          </div>
          {topActive.length === 0 ? (
            <EmptyState
              title="No active returns"
              body="You have no returns in progress. Start one from an eligible order whenever you need to."
              action={<Link to="/customer/returns/new">Start a return</Link>}
            />
          ) : (
            <ul className={styles.list}>
              {topActive.map((item) => (
                <li key={item.id} className={styles.listItem}>
                  <div className={styles.itemMeta}>
                    <Link className={styles.itemTitle} to={`/customer/returns/${item.id}`}>
                      {item.return_number}
                    </Link>
                    <div className={styles.itemSub}>Updated {formatDate(item.updated_at)}</div>
                  </div>
                  <StatusBadge tone={statusTone(item.status)}>{item.status}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="quick-actions-h">
          <div className={styles.panelHead}>
            <h2 id="quick-actions-h">Quick actions</h2>
          </div>
          <div className={styles.actions}>
            <Link className={styles.action} to="/customer/returns/new">
              <span className={styles.actionIcon} aria-hidden="true">
                <Plus size={17} />
              </span>
              <span>
                Start a Return
                <small>From an eligible order item</small>
              </span>
            </Link>
            <Link className={styles.action} to="/customer/track">
              <span className={styles.actionIcon} aria-hidden="true">
                <PackageSearch size={17} />
              </span>
              <span>
                Track a Return
                <small>Live status by return number</small>
              </span>
            </Link>
            <Link className={styles.action} to="/customer/orders">
              <span className={styles.actionIcon} aria-hidden="true">
                <ShoppingBag size={17} />
              </span>
              <span>
                View Orders
                <small>Check eligibility and history</small>
              </span>
            </Link>
            <Link className={styles.action} to="/customer/support">
              <span className={styles.actionIcon} aria-hidden="true">
                <LifeBuoy size={17} />
              </span>
              <span>
                Contact Support
                <small>Raise a help ticket</small>
              </span>
            </Link>
          </div>
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="updates-h">
        <div className={styles.panelHead}>
          <h2 id="updates-h">Important updates</h2>
          <Link className={styles.panelLink} to="/customer/notifications">
            View all notifications
          </Link>
        </div>
        {topUpdates.length === 0 ? (
          <p className={styles.inlineNote}>You are all caught up. No unread notifications.</p>
        ) : (
          <ul className={styles.list}>
            {topUpdates.map((item) => (
              <li key={item.id} className={styles.update}>
                <div className={styles.updateBody}>
                  <div className={styles.updateTitle}>{item.title}</div>
                  <div className={styles.updateText}>{item.body}</div>
                  <div className={styles.updateTime}>{formatDate(item.created_at)}</div>
                </div>
                <button
                  type="button"
                  className={styles.readBtn}
                  disabled={markingId === item.id}
                  onClick={() => void markAsRead(item.id)}
                  aria-label={`Mark notification "${item.title}" as read`}
                >
                  Mark as read
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
