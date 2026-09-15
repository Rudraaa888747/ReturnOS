import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useAsync } from '../../hooks/useAsync'
import { dateOnly, money, returnReasonLabel } from '../../lib/format'
import { errorMessage } from '../../lib/api'
import { listOrders } from '../../services/catalog'
import { createReturn, type NewReturnItem } from '../../services/returns'
import type { Order, ReturnReason } from '../../lib/types'
import {
  Button,
  EmptyState,
  Field,
  FormError,
  InlineSpinner,
  LoadError,
  PageHead,
  Panel,
  SelectInput,
  Skeleton,
  TextArea,
} from '../../components/ui'
import ui from '../../components/ui.module.css'
import { useToast } from '../../components/feedback'

const REASONS: ReturnReason[] = [
  'DAMAGED',
  'DEFECTIVE',
  'WRONG_ITEM',
  'WRONG_SIZE',
  'NOT_AS_DESCRIBED',
  'CHANGED_MIND',
  'MISSING_PARTS',
  'OTHER',
]

interface Pick {
  orderItemId: string
  quantity: number
  reason: ReturnReason | ''
  description: string
}

const STEPS = ['Choose order', 'Items & reasons', 'Review & submit']

export default function NewReturn() {
  const navigate = useNavigate()
  const notify = useToast()
  const { user } = useAuth()
  const isStaff = user?.role !== 'CUSTOMER'
  const [step, setStep] = useState(0)
  const [orderId, setOrderId] = useState('')
  const [picks, setPicks] = useState<Pick[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)

  const orders = useAsync((_signal) => listOrders(0, 20).then((p) => p))
  const [extraOrders, setExtraOrders] = useState<Order[]>([])
  const [nextPage, setNextPage] = useState(1)
  const [moreBusy, setMoreBusy] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  const totalPages = orders.data?.totalPages ?? 1
  const totalElements = orders.data?.totalElements ?? 0
  const allOrders = useMemo(() => {
    const seen = new Set<string>()
    const merged: Order[] = []
    for (const o of [...(orders.data?.content ?? []), ...extraOrders]) {
      if (!seen.has(o.id)) {
        seen.add(o.id)
        merged.push(o)
      }
    }
    return merged
  }, [orders.data, extraOrders])
  const order: Order | undefined = useMemo(
    () => allOrders.find((o) => o.id === orderId),
    [allOrders, orderId],
  )
  const deliverable = useMemo(() => allOrders.filter((o) => o.status === 'DELIVERED'), [allOrders])
  const hasMore = nextPage < totalPages

  const loadMore = async () => {
    setMoreBusy(true)
    setMoreError(null)
    try {
      const page = await listOrders(nextPage, 20)
      setExtraOrders((prev) => [...prev, ...page.content])
      setNextPage((n) => n + 1)
    } catch (err) {
      setMoreError(errorMessage(err))
    } finally {
      setMoreBusy(false)
    }
  }

  const toggleItem = (orderItemId: string) => {
    setPicks((prev) =>
      prev.some((p) => p.orderItemId === orderItemId)
        ? prev.filter((p) => p.orderItemId !== orderItemId)
        : [...prev, { orderItemId, quantity: 1, reason: '', description: '' }],
    )
  }

  const updatePick = (orderItemId: string, patch: Partial<Pick>) => {
    setPicks((prev) => prev.map((p) => (p.orderItemId === orderItemId ? { ...p, ...patch } : p)))
  }

  const picksValid = picks.length > 0 && picks.every((p) => p.reason !== '' && p.quantity >= 1)

  const reviewTotal = useMemo(() => {
    if (!order) return 0
    return picks.reduce((sum, p) => {
      const item = order.items.find((i) => i.id === p.orderItemId)
      return sum + (item ? item.unitPrice * p.quantity : 0)
    }, 0)
  }, [order, picks])

  const submit = async () => {
    if (submitting.current) return
    if (!order || !picksValid) {
      setFormError('Choose at least one item with a quantity and a reason.')
      return
    }
    submitting.current = true
    setFormError(null)
    setBusy(true)
    try {
      const items: NewReturnItem[] = picks.map((p) => ({
        orderItemId: p.orderItemId,
        quantity: p.quantity,
        reason: p.reason as ReturnReason,
        description: p.description.trim() || undefined,
      }))
      const created = await createReturn(order.id, items)
      notify(`Return ${created.returnNumber} requested.`)
      navigate(isStaff ? `/ops/returns/${created.id}` : `/returns/${created.id}`, { replace: true })
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setBusy(false)
      submitting.current = false
    }
  }

  return (
    <>
      <PageHead
        title="Start a return"
        intro={
          isStaff
            ? 'Three short steps. The return attaches to the order\u2019s customer. Only delivered orders can be returned.'
            : 'Three short steps. Only delivered orders can be returned.'
        }
      />
      <ol
        aria-label="Return progress"
        style={{
          listStyle: 'none',
          display: 'flex',
          gap: 'var(--sp-3)',
          padding: 0,
          margin: '0 0 var(--sp-6)',
          flexWrap: 'wrap',
        }}
      >
        {STEPS.map((label, i) => {
          const done = i < step
          const current = i === step
          const inner = (
            <>
              <span
                aria-hidden="true"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 600,
                  background: done ? 'var(--brand)' : current ? 'var(--brand-soft)' : 'var(--surface-sunken)',
                  color: done ? '#fff' : current ? 'var(--brand-strong)' : 'var(--ink-3)',
                  border: current ? '1px solid var(--brand)' : '1px solid transparent',
                }}
              >
                {i + 1}
              </span>
              <span style={{ fontWeight: current ? 600 : 400 }}>{label}</span>
            </>
          )
          return (
            <li
              key={label}
              aria-current={current ? 'step' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-meta)' }}
            >
              {done ? (
                <button
                  type="button"
                  onClick={() => setStep(i)}
                  aria-label={`Back to step ${i + 1}: ${label}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'var(--sp-2)',
                    background: 'none',
                    border: 0,
                    padding: 0,
                    font: 'inherit',
                    color: 'inherit',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    textUnderlineOffset: 3,
                  }}
                >
                  {inner}
                </button>
              ) : (
                inner
              )}
            </li>
          )
        })}
      </ol>

      {orders.loading && <Skeleton height={160} />}
      {orders.error && <LoadError error={orders.error} onRetry={orders.reload} />}

      {orders.data && step === 0 && (
        <Panel title="Which order arrived with a problem?">
          {deliverable.length === 0 ? (
            <EmptyState
              title="No delivered orders"
              body="Only delivered orders can be returned. Orders still on their way will appear here once delivered."
            />
          ) : (
            <div role="radiogroup" aria-label="Delivered orders" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              {deliverable.map((o) => (
                <label
                  key={o.id}
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-3)',
                    alignItems: 'flex-start',
                    border: orderId === o.id ? '1px solid var(--brand)' : '1px solid var(--line)',
                    borderLeftWidth: orderId === o.id ? 3 : 1,
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--sp-3) var(--sp-4)',
                    cursor: 'pointer',
                    background: orderId === o.id ? 'var(--brand-soft)' : 'var(--surface)',
                  }}
                >
                  <input
                    type="radio"
                    name="order"
                    value={o.id}
                    checked={orderId === o.id}
                    onChange={() => {
                      setOrderId(o.id)
                      setPicks([])
                    }}
                    style={{ marginTop: 4, accentColor: 'var(--brand)' }}
                  />
                  <span>
                    <strong className="data">{o.orderNumber}</strong>
                    <span className="meta" style={{ display: 'block' }}>
                      {o.items.length} item{o.items.length === 1 ? '' : 's'} · {money(o.subtotal)} · delivered{' '}
                      {dateOnly(o.deliveredAt)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {hasMore ? (
            <div style={{ marginTop: 'var(--sp-4)' }}>
              <Button size="sm" disabled={moreBusy} onClick={() => void loadMore()}>
                {moreBusy ? (
                  <InlineSpinner label="Loading more orders…" />
                ) : (
                  <>Load more orders ({allOrders.length} of {totalElements} shown)</>
                )}
              </Button>
              {moreError && (
                <p role="alert" className="meta" style={{ color: 'var(--bad)', marginTop: 'var(--sp-2)' }}>
                  {moreError}
                </p>
              )}
            </div>
          ) : (
            totalPages > 1 && (
              <p className="meta" style={{ marginTop: 'var(--sp-4)' }}>
                Showing all {allOrders.length} orders.
              </p>
            )
          )}
          <div style={{ marginTop: 'var(--sp-5)', display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="primary" disabled={!order} onClick={() => setStep(1)}>
              Continue to items
            </Button>
          </div>
        </Panel>
      )}

      {orders.data && step === 1 && order && (
        <Panel title={`What is going back from ${order.orderNumber}?`}>
          {order.items.map((item) => {
            const pick = picks.find((p) => p.orderItemId === item.id)
            const selected = Boolean(pick)
            return (
              <div
                key={item.id}
                style={{
                  border: selected ? '1px solid var(--brand)' : '1px solid var(--line)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--sp-3) var(--sp-4)',
                  marginBottom: 'var(--sp-3)',
                  background: selected ? '#fbfdff' : 'var(--surface)',
                }}
              >
                <label className={ui.checkRow} style={{ marginBottom: selected ? 'var(--sp-2)' : 0 }}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleItem(item.id)}
                    aria-describedby={`item-${item.id}-meta`}
                  />
                  <span>
                    <strong>
                      {item.quantity} × {item.productName}
                    </strong>{' '}
                    <span className="meta data" id={`item-${item.id}-meta`}>
                      {item.sku} · {money(item.unitPrice)} each
                    </span>
                  </span>
                </label>
                {pick && (
                  <div className={ui.grid2}>
                    <Field label="Quantity to return" htmlFor={`qty-${item.id}`}>
                      <span style={{ display: 'inline-flex', alignItems: 'stretch', gap: 0 }}>
                        <Button
                          size="sm"
                          aria-label={`Return one fewer of ${item.productName}`}
                          disabled={pick.quantity <= 1}
                          onClick={() => updatePick(item.id, { quantity: pick.quantity - 1 })}
                        >
                          −
                        </Button>
                        <span
                          id={`qty-${item.id}`}
                          role="status"
                          aria-label={`Quantity to return: ${pick.quantity} of ${item.quantity}`}
                          className="data"
                          style={{
                            minWidth: 64,
                            textAlign: 'center',
                            alignContent: 'center',
                            borderTop: '1px solid var(--line-strong)',
                            borderBottom: '1px solid var(--line-strong)',
                            fontWeight: 600,
                          }}
                        >
                          {pick.quantity} / {item.quantity}
                        </span>
                        <Button
                          size="sm"
                          aria-label={`Return one more of ${item.productName}`}
                          disabled={pick.quantity >= item.quantity}
                          onClick={() => updatePick(item.id, { quantity: pick.quantity + 1 })}
                        >
                          +
                        </Button>
                      </span>
                    </Field>
                    <Field label="Reason" htmlFor={`reason-${item.id}`}>
                      <SelectInput
                        id={`reason-${item.id}`}
                        value={pick.reason}
                        onChange={(e) => updatePick(item.id, { reason: e.target.value as ReturnReason })}
                      >
                        <option value="">Select a reason…</option>
                        {REASONS.map((r) => (
                          <option key={r} value={r}>
                            {returnReasonLabel[r]}
                          </option>
                        ))}
                      </SelectInput>
                    </Field>
                  </div>
                )}
                {pick && (
                  <Field label="Note for the warehouse (optional)" htmlFor={`note-${item.id}`}>
                    <TextArea
                      id={`note-${item.id}`}
                      placeholder="e.g. right speaker crackles at high volume"
                      value={pick.description}
                      onChange={(e) => updatePick(item.id, { description: e.target.value })}
                    />
                  </Field>
                )}
              </div>
            )
          })}
          <div style={{ marginTop: 'var(--sp-5)', display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={() => setStep(0)}>Back</Button>
            <Button variant="primary" disabled={!picksValid} onClick={() => setStep(2)}>
              Review return
            </Button>
          </div>
        </Panel>
      )}

      {orders.data && step === 2 && order && (
        <Panel title="Review before submitting">
          <dl style={{ margin: 0 }}>
            {picks.map((p) => {
              const item = order.items.find((i) => i.id === p.orderItemId)!
              return (
                <div className={ui.kv} key={p.orderItemId}>
                  <dt>
                    {p.quantity} × {item.productName}
                  </dt>
                  <dd>
                    {p.reason ? returnReasonLabel[p.reason as ReturnReason] : '—'}
                    {' · '}
                    <span className="data">{money(item.unitPrice * p.quantity)}</span>
                    {p.description && <span className="meta"> — {p.description}</span>}{' '}
                    <Button size="sm" onClick={() => setStep(1)}>
                      Edit items
                    </Button>
                  </dd>
                </div>
              )
            })}
            <div className={ui.kv}>
              <dt>Total affected value</dt>
              <dd className="data">{money(reviewTotal)}</dd>
            </div>
          </dl>
          <p style={{ marginTop: 'var(--sp-3)' }}>
            <Button
              size="sm"
              onClick={() => {
                setOrderId('')
                setPicks([])
                setStep(0)
              }}
            >
              Change order
            </Button>
          </p>
          <FormError message={formError} />
          <div style={{ marginTop: 'var(--sp-5)', display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={() => setStep(1)} disabled={busy}>
              Back
            </Button>
            <Button variant="primary" onClick={submit} disabled={busy}>
              {busy ? <InlineSpinner label="Submitting…" /> : 'Submit return'}
            </Button>
          </div>
        </Panel>
      )}

      <p style={{ marginTop: 'var(--sp-4)' }}>
        <Link to="/returns">← Back to my returns</Link>
      </p>
      {orders.data && orders.data.totalElements > 0 && (
        <p className="meta">
          {orders.data.content.filter((o) => o.status !== 'DELIVERED').length > 0 && (
            <>Only delivered orders are eligible — the warehouse must have proof of delivery first.</>
          )}
        </p>
      )}
    </>
  )
}
