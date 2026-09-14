import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAsync } from '../../hooks/useAsync'
import { dateOnly, returnReasonLabel, returnStatusLabel } from '../../lib/format'
import { listReturns } from '../../services/returns'
import type { ReturnStatus } from '../../lib/types'
import {
  EmptyState,
  Field,
  LoadError,
  PageHead,
  Pagination,
  SelectInput,
  Skeleton,
  TextInput,
} from '../../components/ui'
import ui from '../../components/ui.module.css'
import { ReturnBadge } from '../../components/status'

const STATUSES: ('' | ReturnStatus)[] = [
  '',
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'IN_TRANSIT',
  'RECEIVED',
  'INSPECTION_PENDING',
  'INSPECTION_IN_PROGRESS',
  'INSPECTION_COMPLETED',
]

function ageDays(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000))
  return days === 0 ? 'today' : `${days}d old`
}

export default function WorkQueue() {
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') ?? '') as '' | ReturnStatus
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState('')

  const { data, error, loading, reload } = useAsync(
    () => listReturns({ status: status || undefined, page, size: 12 }),
    [status, page],
  )

  const setStatus = (next: '' | ReturnStatus) => {
    setPage(0)
    if (next) setParams({ status: next })
    else setParams({})
  }

  const visible =
    data?.content.filter((r) => {
      const q = query.trim().toLowerCase()
      if (!q) return true
      return r.returnNumber.toLowerCase().includes(q) || r.items.some((i) => i.sku.toLowerCase().includes(q))
    }) ?? []

  return (
    <>
      <PageHead title="Work queue" intro="Scan every return in the building. Oldest first keeps the floor fair." />
      <div className={ui.toolbar} role="search">
        <Field label="Status" htmlFor="wq-status">
          <SelectInput id="wq-status" value={status} onChange={(e) => setStatus(e.target.value as '' | ReturnStatus)}>
            <option value="">All statuses</option>
            {(STATUSES.filter(Boolean) as ReturnStatus[]).map((s) => (
              <option key={s} value={s}>
                {returnStatusLabel[s]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Search this page" htmlFor="wq-q" hint="Return number or SKU.">
          <TextInput
            id="wq-q"
            type="search"
            placeholder="RET-… or SKU-…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
      </div>

      {loading && (
        <>
          <Skeleton height={52} />
          <div style={{ height: 'var(--sp-2)' }} />
          <Skeleton height={52} />
          <div style={{ height: 'var(--sp-2)' }} />
          <Skeleton height={52} />
        </>
      )}
      {error && <LoadError error={error} onRetry={reload} />}
      {data && visible.length === 0 && (
        <EmptyState
          title={query || status ? 'Nothing matches' : 'Queue is empty'}
          body={query || status ? 'Try a different status or clear the search.' : 'No returns in the system yet.'}
        />
      )}
      {data && visible.length > 0 && (
        <>
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                Return work queue
              </caption>
              <thead>
                <tr>
                  <th scope="col">Return</th>
                  <th scope="col">Contents</th>
                  <th scope="col">Age</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td data-th="Return">
                      <Link to={`/ops/returns/${r.id}`} className={`${ui.rowLink} data`}>
                        {r.returnNumber}
                      </Link>
                      <div className="meta data">{dateOnly(r.requestedAt)}</div>
                    </td>
                    <td data-th="Contents">{r.items.map((i) => `${i.quantity} × ${i.sku} (${returnReasonLabel[i.reason]})`).join(', ')}</td>
                    <td data-th="Age">{ageDays(r.requestedAt)}</td>
                    <td data-th="Status">
                      <ReturnBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={data.number}
            totalPages={data.totalPages}
            totalElements={data.totalElements}
            onPage={setPage}
            label={data.totalElements === 1 ? 'return' : 'returns'}
          />
        </>
      )}
    </>
  )
}
