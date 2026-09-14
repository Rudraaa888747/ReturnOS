import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
  TextInput,
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
  const [step, setStep] = useState(0)
  const [orderId, setOrderId] = useState('')
  const [picks, setPicks] = useState<Pick[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const orders = useAsync((_signal) => listOrders(0, 20).then((p) => p))
  const order: Order | undefined = useMemo(
    () => orders.data?.content.find((o) => o.id === orderId),
    [orders.data, orderId],
  )
  const deliverable = useMemo(
    () => orders.data?.content.filter((o) => o.status === 'DELIVERED') ?? [],
    [orders.data],
  )

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

  const submit = async () => {
    if (!order || !picksValid) {
      setFormError('Choose at least one item with a quantity and a reason.')
      return
    }
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
      navigate(`/returns/${created.id}`, { replace: true })
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHead title="Start a return" intro="Three short steps. Only delivered orders can be returned." />
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
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === step ? 'step' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-meta)' }}
          >
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
                background: i < step ? 'var(--brand)' : i === step ? 'var(--brand-soft)' : 'var(--surface-sunken)',
                color: i < step ? '#fff' : i === step ? 'var(--brand-strong)' : 'var(--ink-3)',
                border: i === step ? '1px solid var(--brand)' : '1px solid transparent',
              }}
            >
              {i + 1}
            </span>
            <span style={{ fontWeight: i === step ? 600 : 400 }}>{label}</span>
          </li>
        ))}
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
                    border: '1px solid var(--line)',
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
            return (
              <div key={item.id} style={{ borderBottom: '1px solid var(--line)', padding: 'var(--sp-3) 0' }}>
                <label className={ui.checkRow} style={{ marginBottom: 'var(--sp-2)' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(pick)}
                    onChange={() => toggleItem(item.id)}
                  />
                  <span>
                    <strong>
                      {item.quantity} × {item.productName}
                    </strong>{' '}
                    <span className="meta data">
                      {item.sku} · {money(item.unitPrice)} each
                    </span>
                  </span>
                </label>
                {pick && (
                  <div className={ui.grid2}>
                    <Field label="Quantity to return" htmlFor={`qty-${item.id}`}>
                      <TextInput
                        id={`qty-${item.id}`}
                        type="number"
                        min={1}
                        max={item.quantity}
                        value={pick.quantity}
                        onChange={(e) =>
                          updatePick(item.id, {
                            quantity: Math.max(1, Math.min(item.quantity, Number(e.target.value) || 1)),
                          })
                        }
                      />
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
                    {p.description && <span className="meta"> — {p.description}</span>}
                  </dd>
                </div>
              )
            })}
          </dl>
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
