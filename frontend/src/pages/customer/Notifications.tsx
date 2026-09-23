import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCheck } from 'lucide-react'
import { api, friendlyMessage } from '../../lib/api'
import type { NotificationRow } from '../../lib/api'
import { EmptyState, ErrorState, LoadingState, PageHead } from '../../components/ui'
import styles from './notifications.module.css'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

export default function Notifications() {
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true)
      setError(null)
      try {
        const data = await api<{ notifications: NotificationRow[] }>('/notifications')
        if (!cancelled) {
          setNotifications(data.notifications)
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

  async function markOneAsRead(id: string): Promise<void> {
    setMarkingId(id)
    try {
      await api<{ message: string }>(`/notifications/${id}/read`, { method: 'POST' })
      setNotifications((prev) =>
        prev.map((item) => (item.id === id ? { ...item, is_read: 1 } : item)),
      )
    } catch {
      // Leave the item unread; the error is non-blocking for the list view.
    } finally {
      setMarkingId(null)
    }
  }

  async function markAllAsRead(): Promise<void> {
    setMarkingAll(true)
    try {
      await api<{ message: string; updated: number }>('/notifications/read-all', { method: 'POST' })
      setNotifications((prev) => prev.map((item) => ({ ...item, is_read: 1 })))
    } catch {
      // Keep current state; the list itself already loaded successfully.
    } finally {
      setMarkingAll(false)
    }
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <PageHead kicker="Customer" title="Notifications" lede="Updates about your returns and account." />
        <LoadingState label="Loading notifications" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.page}>
        <PageHead kicker="Customer" title="Notifications" lede="Updates about your returns and account." />
        <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} />
      </div>
    )
  }

  const unreadCount = notifications.filter((item) => item.is_read === 0).length

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Customer"
        title="Notifications"
        lede={unreadCount > 0 ? `${unreadCount} unread update(s).` : 'You are all caught up.'}
        actions={
          notifications.length > 0 && unreadCount > 0 ? (
            <button type="button" className={styles.readBtn} disabled={markingAll} onClick={() => void markAllAsRead()}>
              <CheckCheck size={15} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />
              {markingAll ? 'Marking…' : 'Mark all as read'}
            </button>
          ) : undefined
        }
      />

      {notifications.length === 0 ? (
        <EmptyState title="No notifications" body="Updates about your returns, pickups, and refunds will appear here." />
      ) : (
        <section className={styles.panel} aria-label="Notification list">
          <ul className={styles.list}>
            {notifications.map((item) => {
              const unread = item.is_read === 0
              return (
                <li key={item.id} className={`${styles.item} ${unread ? styles.itemUnread : ''}`}>
                  <div className={styles.itemBody}>
                    <div className={styles.itemTop}>
                      <span className={styles.typeLabel}>{item.type}</span>
                      <span className={styles.itemTitle}>{item.title}</span>
                    </div>
                    <div className={styles.itemText}>{item.body}</div>
                    <div className={styles.itemTime}>{formatDate(item.created_at)}</div>
                    {item.return_id && (
                      <Link className={styles.itemLink} to={`/customer/returns/${item.return_id}`}>
                        View return
                      </Link>
                    )}
                  </div>
                  {unread && (
                    <button
                      type="button"
                      className={styles.readBtn}
                      disabled={markingId === item.id}
                      onClick={() => void markOneAsRead(item.id)}
                      aria-label={`Mark notification "${item.title}" as read`}
                    >
                      {markingId === item.id ? 'Marking…' : 'Mark as read'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
