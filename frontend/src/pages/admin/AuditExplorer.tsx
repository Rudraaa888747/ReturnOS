import { useState } from 'react'
import { useAsync } from '../../hooks/useAsync'
import { dateTime } from '../../lib/format'
import { listAudit } from '../../services/admin'
import {
  EmptyState,
  Field,
  LoadError,
  PageHead,
  Pagination,
  Skeleton,
  TextInput,
} from '../../components/ui'
import ui from '../../components/ui.module.css'

export default function AuditExplorer() {
  const [entityId, setEntityId] = useState('')
  const [applied, setApplied] = useState('')
  const [page, setPage] = useState(0)
  const { data, error, loading, reload } = useAsync(
    () => listAudit({ entityId: applied || undefined, page, size: 20 }),
    [applied, page],
  )

  return (
    <>
      <PageHead
        title="Audit trail"
        intro="Every audited action, newest first. Filter by return, execution or task ID to follow one story."
      />
      <form
        className={ui.toolbar}
        onSubmit={(e) => {
          e.preventDefault()
          setPage(0)
          setApplied(entityId.trim())
        }}
      >
        <Field label="Entity ID" htmlFor="audit-eid" hint="Return, execution, claim, recovery or task UUID.">
          <TextInput
            id="audit-eid"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder="e.g. 3fa85f64-…"
          />
        </Field>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', paddingBottom: 1 }}>
          <button type="submit" className={`${ui.btn} ${ui.btnSecondary} ${ui.btnSm}`}>
            Filter
          </button>
          {(applied || entityId) && (
            <button
              type="button"
              className={`${ui.btn} ${ui.btnSecondary} ${ui.btnSm}`}
              onClick={() => {
                setEntityId('')
                setApplied('')
                setPage(0)
              }}
            >
              Clear
            </button>
          )}
        </div>
      </form>

      {loading && (
        <>
          <Skeleton height={44} />
          <div style={{ height: 'var(--sp-2)' }} />
          <Skeleton height={44} />
          <div style={{ height: 'var(--sp-2)' }} />
          <Skeleton height={44} />
        </>
      )}
      {error && <LoadError error={error} onRetry={reload} />}
      {data && data.content.length === 0 && (
        <EmptyState title="No audit entries" body="Try a different entity ID, or wait for activity." />
      )}
      {data && data.content.length > 0 && (
        <>
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                Audit events
              </caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.content.map((e) => (
                  <tr key={e.id}>
                    <td data-th="When" className="data" style={{ whiteSpace: 'nowrap' }}>
                      {dateTime(e.createdAt)}
                    </td>
                    <td data-th="Action">
                      <strong>{e.action.replace(/_/g, ' ').toLowerCase()}</strong>
                      <div className="meta">
                        {e.entityType} · <span className="data">{e.entityId.slice(0, 8)}…</span>
                      </div>
                    </td>
                    <td data-th="Actor">{e.performedBy ?? '—'}</td>
                    <td data-th="Detail">
                      {e.reason ?? '—'}
                      {e.metadata && <div className="meta data">{e.metadata}</div>}
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
            label={data.totalElements === 1 ? 'event' : 'events'}
          />
        </>
      )}
    </>
  )
}
