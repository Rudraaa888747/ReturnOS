import { dateTime } from '../../../lib/format';
import { Disclosure } from '../../../components/ui';
import type { WorkspaceData } from './types';

export function HistoryPanel({ data }: { data: WorkspaceData }) {
  const { history } = data
  return (
    <Disclosure
      title={`History (${history.events.length})`}
      sub="Full audit trail for this return, oldest first."
    >
      {history.events.length === 0 ? (
        <p className="meta">No events recorded yet.</p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {history.events.map((e, i) => (
            <li
              key={`${e.action}-${e.timestamp}-${i}`}
              style={{ padding: 'var(--sp-2) 0', borderTop: i === 0 ? 0 : '1px solid var(--line)', fontSize: 'var(--fs-body)' }}
            >
              <strong>{e.action.replace(/_/g, ' ').toLowerCase()}</strong>{' '}
              <span className="meta data">{dateTime(e.timestamp)}</span>
              {e.actor && <span className="meta"> · {e.actor}</span>}
              {e.reason && <div className="meta">{e.reason}</div>}
            </li>
          ))}
        </ol>
      )}
    </Disclosure>
  )
}
