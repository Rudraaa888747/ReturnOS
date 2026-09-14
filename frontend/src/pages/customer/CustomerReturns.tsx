import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../../hooks/useAsync'
import { dateOnly, returnReasonLabel, returnStatusLabel } from '../../lib/format'
import { listReturns } from '../../services/returns'
import type { ReturnStatus } from '../../lib/types'
import {
  EmptyState,
  Field,
  LinkButton,
  LoadError,
  PageHead,
  Pagination,
  SelectInput,
  Skeleton,
  TextInput,
} from '../../components/ui'
import ui from '../../components/ui.module.css'
import { ReturnBadge } from '../../components/status'

const STATUS_OPTIONS: ('' | ReturnStatus)[] = [
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

export default function CustomerReturns() {
  const [status, setStatus] = useState<'' | ReturnStatus>('')
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState('')
  const { data, error, loading, reload } = useAsync(
    (_signal) => listReturns({ status: status || undefined, page, size: 10 }),
    [status, page],
  )

  const visible = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    if (!q) return data.content
    return data.content.filter(
      (r) =>
        r.returnNumber.toLowerCase().includes(q) ||
        r.items.some((i) => i.sku.toLowerCase().includes(q)),
    )
  }, [data, query])

  return (
    <>
      <PageHead
        title="My returns"
        intro="Every return you've raised, newest first."
        actions={
          <LinkButton to="/returns/new" variant="primary">
            Start a return
          </LinkButton>
        }
      />
      <div className={ui.toolbar} role="search">
        <Field label="Status" htmlFor="flt-status">
          <SelectInput
            id="flt-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as '' | ReturnStatus)
              setPage(0)
            }}
          >
            <option value="">All statuses</option>
            {(STATUS_OPTIONS.filter(Boolean) as Exclude<(typeof STATUS_OPTIONS)[number], ''>[]).map((s) => (
              <option key={s} value={s}>
                {returnStatusLabel[s]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Search this page" htmlFor="flt-q" hint="Matches return number or SKU.">
          <TextInput
            id="flt-q"
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
          title={query || status ? 'Nothing matches those filters' : 'No returns yet'}
          body={
            query || status
              ? 'Try a different status or clear the search.'
              : 'When something you ordered needs to go back, start a return and follow it here.'
          }
          action={
            !query && !status ? (
              <LinkButton to="/returns/new" variant="primary">
                Start a return
              </LinkButton>
            ) : undefined
          }
        />
      )}
      {data && visible.length > 0 && (
        <>
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                Your returns
              </caption>
              <thead>
                <tr>
                  <th scope="col">Return</th>
                  <th scope="col">Items</th>
                  <th scope="col">Requested</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td data-th="Return">
                      <Link to={`/returns/${r.id}`} className={`${ui.rowLink} data`}>
                        {r.returnNumber}
                      </Link>
                    </td>
                    <td data-th="Items">
                      {r.items.map((i) => `${i.quantity} × ${i.sku} (${returnReasonLabel[i.reason]})`).join(', ')}
                    </td>
                    <td data-th="Requested" className="data">
                      {dateOnly(r.requestedAt)}
                    </td>
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
