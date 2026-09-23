import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ad } from '../../lib/admin'
import { ErrorState, LoadingState, PageHead, StatusBadge } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

interface Detail {
  id: string;
  code: string;
  name: string;
  city: string;
  active: number;
  locations: Array<{ id: string; code: string; name: string; kind: string; active: number }>;
  operators: Array<{ id: string; email: string; full_name: string; active: number; created_at: string }>;
  recentReceiving: Array<{ id: string; return_id: string; received_quantity: number; created_at: string }>;
  openTasks: Array<{ id: string; title: string; kind: string; status: string; due_at: string }>;
}

export default function WarehouseDetail() {
  const { id } = useParams()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      if (!id) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const data = await ad<Detail>(`/warehouses/${id}`)
        if (!cancelled) setDetail(data)
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 404) {
            setNotFound(true)
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
  }, [id, attempt])

  if (loading) {
    return (
      <div>
        <PageHead kicker="Admin" title="Warehouse" lede="Loading the site file." />
        <LoadingState label="Loading warehouse…" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div>
        <PageHead kicker="Admin" title="Warehouse" lede="Check the link and try again." />
        <ErrorState message="Warehouse not found." />
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div>
        <PageHead kicker="Admin" title="Warehouse" lede="Check the link and try again." />
        <ErrorState message={error ?? 'Warehouse could not be loaded.'} onRetry={() => setAttempt((v) => v + 1)} />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Admin"
        title={`${detail.code} · ${detail.name}`}
        lede={detail.city || 'Warehouse site file.'}
        actions={<Link to="/admin/warehouses">Back to warehouses</Link>}
      />

      <section className={ops.panel} aria-label="Site facts">
        <div className={styles.factGrid}>
          <Fact label="Status">
            <StatusBadge tone={detail.active === 1 ? 'ok' : 'bad'}>{detail.active === 1 ? 'Active' : 'Disabled'}</StatusBadge>
          </Fact>
          <Fact label="Operators" mono>
            {detail.operators.length}
          </Fact>
          <Fact label="Locations" mono>
            {detail.locations.length}
          </Fact>
          <Fact label="Open tasks" mono>
            {detail.openTasks.length}
          </Fact>
        </div>
      </section>

      <div className={styles.twoCol}>
        <section className={ops.panel} aria-label="Locations">
          <h2 className={ops.panelTitle}>Locations ({detail.locations.length})</h2>
          {detail.locations.length === 0 ? (
            <p className={ops.muted}>No locations configured.</p>
          ) : (
            <ul className={styles.plainList}>
              {detail.locations.map((location) => (
                <li key={location.id}>
                  <span className={ops.mono}>{location.code}</span>{' '}
                  <span className={ops.muted}>
                    {location.name} · {location.kind.replaceAll('_', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h3 className={styles.subTitle}>Operators ({detail.operators.length})</h3>
          {detail.operators.length === 0 ? (
            <p className={ops.muted}>No operators assigned.</p>
          ) : (
            <ul className={styles.plainList}>
              {detail.operators.map((operator) => (
                <li key={operator.id}>
                  {operator.full_name}{' '}
                  <span className={ops.muted}>
                    {operator.email} · {operator.active === 1 ? 'active' : 'disabled'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={ops.panel} aria-label="Recent intake and open work">
          <h2 className={ops.panelTitle}>Recent receiving ({detail.recentReceiving.length})</h2>
          {detail.recentReceiving.length === 0 ? (
            <p className={ops.muted}>Nothing received recently.</p>
          ) : (
            <ul className={styles.plainList}>
              {detail.recentReceiving.map((record) => (
                <li key={record.id}>
                  <span className={ops.mono}>
                    ×{record.received_quantity} · {formatDate(record.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h3 className={styles.subTitle}>Open tasks ({detail.openTasks.length})</h3>
          {detail.openTasks.length === 0 ? (
            <p className={ops.muted}>No open tasks.</p>
          ) : (
            <ul className={styles.plainList}>
              {detail.openTasks.map((task) => (
                <li key={task.id}>
                  {task.title}{' '}
                  <span className={ops.muted}>
                    {task.kind.replaceAll('_', ' ')} · due {formatDate(task.due_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function Fact({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      <span className={mono ? ops.mono : styles.factValue}>{children}</span>
    </div>
  )
}
