import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, X } from 'lucide-react';
import { api, friendlyMessage } from '../../lib/api';
import type { ReturnRow } from '../../lib/api';
import { productImageFor } from '../../lib/productImage';
import { EmptyState, ErrorState, FilterChips, PageHead, StatusBadge, statusTone } from '../../components/ui';
import styles from './returns.module.css';

type Filter = 'ALL' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const COMPLETED_STATUSES = new Set(['COMPLETED', 'RESOLVED', 'REFUNDED', 'REJECTED']);
const CANCELLED_STATUSES = new Set(['CANCELLED']);

/**
 * Same pic as Store/My Orders: backend snapshot wins, else map by product name.
 */
function returnImage(row: ReturnRow): string {
  return productImageFor({
    imageUrl: row.productImageUrl ?? row.product_image_url,
    name: row.productName ?? row.product_name,
  });
}

function returnProductName(row: ReturnRow): string {
  const name = row.productName ?? row.product_name;
  if (name && name.trim() !== '') return name;
  return 'Return request';
}

function returnSearchText(row: ReturnRow): string {
  const parts = [returnProductName(row), row.return_number, row.orderNumber ?? '', row.status];
  return parts.join(' ').toLowerCase();
}

function groupOf(status: string): Exclude<Filter, 'ALL'> {
  const normalized = status.toUpperCase();
  if (CANCELLED_STATUSES.has(normalized)) return 'CANCELLED';
  if (COMPLETED_STATUSES.has(normalized)) return 'COMPLETED';
  return 'ACTIVE';
}

/** Statuses where the parcel is actively moving — only these badges pulse. */
const IN_PROGRESS_STATUSES = new Set(['APPROVED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'IN_TRANSIT', 'INSPECTION']);

function isInProgress(status: string): boolean {
  return IN_PROGRESS_STATUSES.has(status.toUpperCase());
}

/** Left-accent class for a card, reflecting its status group. */
function cardGroupClass(group: Exclude<Filter, 'ALL'>): string {
  if (group === 'COMPLETED') return styles.cardCompleted;
  if (group === 'CANCELLED') return styles.cardCancelled;
  return styles.cardActive;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export default function Returns() {
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await api<{ returns: ReturnRow[] }>('/returns');
        if (alive) setReturns(data.returns);
      } catch (err) {
        if (alive) setError(friendlyMessage(err));
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, []);

  const byStatus = filter === 'ALL' ? returns : returns.filter((row) => groupOf(row.status) === filter);
  const trimmedQuery = query.trim().toLowerCase();
  const visible =
    trimmedQuery === '' ? byStatus : byStatus.filter((row) => returnSearchText(row).includes(trimmedQuery));
  const counts: Record<Filter, number> = {
    ALL: returns.length,
    ACTIVE: returns.filter((row) => groupOf(row.status) === 'ACTIVE').length,
    COMPLETED: returns.filter((row) => groupOf(row.status) === 'COMPLETED').length,
    CANCELLED: returns.filter((row) => groupOf(row.status) === 'CANCELLED').length,
  };

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Returns"
        title="My returns"
        lede="Track every return request, its current status, and what happens next."
        actions={
          <Link className={styles.link} to="/customer/returns/new">
            <Plus size={16} aria-hidden="true" className={styles.btnIcon} /> Start a new return
          </Link>
        }
      />

      {loading ? (
        <div className={styles.skeletonList} role="status" aria-label="Loading your returns…">
          {[0, 1, 2].map((index) => (
            <div key={index} className={styles.skeletonCard} aria-hidden="true">
              <span className={styles.skeletonThumb} />
              <span className={styles.skeletonLines}>
                <span />
                <span />
              </span>
            </div>
          ))}
          <span className={styles.searchLabel}>Loading your returns…</span>
        </div>
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            setError(null);
            void api<{ returns: ReturnRow[] }>('/returns')
              .then((data) => {
                setReturns(data.returns);
                setLoading(false);
              })
              .catch((err: unknown) => {
                setError(friendlyMessage(err));
                setLoading(false);
              });
          }}
        />
      ) : returns.length === 0 ? (
        <EmptyState
          title="No returns yet"
          body="When you request a return for one of your orders, it will appear here with live status updates."
          action={
            <Link className={`${styles.link} ${styles.linkCta}`} to="/customer/returns/new">
              <Plus size={16} aria-hidden="true" className={styles.btnIcon} /> Start your first return
            </Link>
          }
        />
      ) : (
        <>
          <FilterChips
            ariaLabel="Filter returns by status"
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((option) => ({ value: option.value, label: option.label, count: counts[option.value] }))}
          />

          <div className={styles.searchRow}>
            <Search size={16} aria-hidden="true" className={styles.searchIcon} />
            <label className={styles.searchLabel} htmlFor="returns-search">
              Filter by product or return number
            </label>
            <input
              id="returns-search"
              className={styles.searchInput}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by product name or return number"
              autoComplete="off"
            />
            {query !== '' && (
              <button type="button" className={styles.searchClear} onClick={() => setQuery('')} aria-label="Clear search">
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </div>

          {visible.length === 0 ? (
            <p className={styles.helper} role="status">
              No returns match this filter.
            </p>
          ) : (
            <ul className={styles.list}>
              {visible.map((row, index) => {
                const quantity = row.itemQuantity ?? row.item_quantity;
                const group = groupOf(row.status);
                return (
                  <li
                    key={row.id}
                    className={`${styles.card} ${cardGroupClass(group)}`}
                    style={{ '--card-index': index } as CSSProperties}
                  >
                    <div className={styles.productRow}>
                      <span className={styles.thumbWrap} aria-hidden="true">
                        <img
                          className={styles.productThumb}
                          src={returnImage(row)}
                          alt=""
                          loading="lazy"
                        />
                      </span>
                      <div className={styles.productMain}>
                        <h2 className={styles.productName}>{returnProductName(row)}</h2>
                        {typeof quantity === 'number' && (
                          <p className={styles.productSub}>
                            {quantity} item(s)
                            {row.orderNumber ? ` · Order ${row.orderNumber}` : ''}
                          </p>
                        )}
                      </div>
                      {isInProgress(row.status) ? (
                        <span className={styles.statusPulse}>
                          <StatusBadge tone={statusTone(row.status)}>{row.status.replaceAll('_', ' ')}</StatusBadge>
                        </span>
                      ) : (
                        <StatusBadge tone={statusTone(row.status)}>{row.status.replaceAll('_', ' ')}</StatusBadge>
                      )}
                    </div>
                    <dl className={styles.cardMeta}>
                      <div>
                        <dt>Resolution</dt>
                        <dd>{row.resolution_type ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{formatDate(row.updated_at)}</dd>
                      </div>
                      <div>
                        <dt>Return ID</dt>
                        <dd className={styles.cardMono}>{row.return_number}</dd>
                      </div>
                    </dl>
                    <div className={styles.cardFoot}>
                      <Link className={styles.link} to={`/customer/returns/${row.id}`}>
                        View details
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
