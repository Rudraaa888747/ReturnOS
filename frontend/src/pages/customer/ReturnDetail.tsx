import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, Download, FileText, Star, Upload } from 'lucide-react';
import { ApiError, api, friendlyMessage, getToken, uploadFile } from '../../lib/api';
import type { DocumentRow, FeedbackRow, ReturnDetail as ReturnDetailData, ReturnEventRow } from '../../lib/api';
import { EmptyState, ErrorState, FieldError, LoadingState, PageHead, StatusBadge, statusTone } from '../../components/ui';
import { GENERIC_PRODUCT_IMAGE, orderItemImageFor } from '../../lib/productImage';
import styles from './returns.module.css';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return inr.format(value);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .split('_')
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface QaCopy {
  happened: string;
  now: string;
  next: string;
  needed: string;
}

function qaForStatus(status: string, returnNumber: string): QaCopy {
  const normalized = status.toUpperCase();
  const base: QaCopy = {
    happened: `Return ${returnNumber} was requested and recorded with your chosen items and reasons.`,
    now: 'Your return is being processed.',
    next: 'We will update the status here as soon as the next step completes.',
    needed: 'Nothing is needed from you right now.',
  };
  switch (normalized) {
    case 'REQUESTED':
      return {
        ...base,
        now: 'Your request is waiting for review. The warehouse team checks eligibility and the reason provided.',
        next: 'Once approved, pickup or drop-off instructions will appear below.',
        needed: 'Nothing yet. You can cancel the request below if you change your mind.',
      };
    case 'APPROVED':
      return {
        ...base,
        now: 'Your return was approved. Pickup or drop-off is being arranged.',
        next: 'Hand over the items as instructed in the pickup panel. The status will change to In transit once collected.',
        needed: 'Keep the items packed and ready, and keep the pickup address accessible.',
      };
    case 'IN_TRANSIT':
      return {
        ...base,
        now: 'Your items are on their way back to the warehouse.',
        next: 'On arrival the status changes to Received, then the items go to inspection.',
      };
    case 'RECEIVED':
      return {
        ...base,
        now: 'The warehouse received your items.',
        next: 'Inspection starts shortly. The outcome determines your refund or replacement.',
      };
    case 'INSPECTION_PENDING':
    case 'INSPECTION_IN_PROGRESS':
      return {
        ...base,
        now: 'Your items are being inspected for condition and completeness.',
        next: 'After inspection, the resolution (refund, replacement, or store credit) is processed.',
      };
    case 'COMPLETED':
    case 'RESOLVED':
    case 'REFUNDED':
      return {
        ...base,
        now: 'Your return is complete and the resolution has been processed.',
        next: 'Refunds can take a few business days to reach your account. Replacements ship separately.',
        needed: 'Please rate your experience below so we can improve.',
      };
    case 'REJECTED':
      return {
        ...base,
        now: 'This return request was rejected. The reason from the review team is shown in the timeline.',
        next: 'If you disagree, contact support and reference your return number.',
        needed: 'Contact support if you need to appeal this decision.',
      };
    case 'CANCELLED':
      return {
        ...base,
        now: 'This return was cancelled. No further action will be taken.',
        next: 'If you still need to return the items, start a new return request.',
      };
    default:
      return base;
  }
}

export default function ReturnDetail() {
  const { id } = useParams();
  const location = useLocation();
  const created = ((location.state as { created?: boolean } | null) ?? {}).created === true;

  const [detail, setDetail] = useState<ReturnDetailData | null>(null);
  const [timeline, setTimeline] = useState<ReturnEventRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [uploadPending, setUploadPending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [cancelPending, setCancelPending] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const [feedback, setFeedback] = useState<FeedbackRow | null>(null);
  const [feedbackChecked, setFeedbackChecked] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [detailData, timelineData, docsData] = await Promise.all([
        api<ReturnDetailData>(`/returns/${id}`),
        api<{ events: ReturnEventRow[] }>(`/returns/${id}/timeline`).catch(() => ({ events: [] as ReturnEventRow[] })),
        api<{ documents: DocumentRow[] }>(`/documents/return/${id}`).catch(() => ({ documents: [] as DocumentRow[] })),
      ]);
      setDetail(detailData);
      setTimeline(timelineData.events.length > 0 ? timelineData.events : detailData.events);
      setDocuments(docsData.documents);
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!id || !detail) return;
    const status = detail.ret.status.toUpperCase();
    if (status !== 'COMPLETED' && status !== 'RESOLVED') return;
    let alive = true;
    api<{ feedback: FeedbackRow }>(`/feedback/return/${id}`)
      .then((data) => {
        if (alive) setFeedback(data.feedback);
      })
      .catch(() => {
        if (alive) setFeedback(null);
      })
      .finally(() => {
        if (alive) setFeedbackChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [id, detail]);

  async function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !id) return;
    setUploadError(null);
    setUploadNotice(null);
    if (!ACCEPTED_MIME.has(file.type)) {
      setUploadError('Only JPG, PNG, WebP, or PDF files are accepted.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setUploadError('Files must be 5 MB or smaller.');
      return;
    }
    setUploadPending(true);
    try {
      await uploadFile<{ document: DocumentRow }>(`/uploads/return/${id}`, file, { kind: 'EVIDENCE' });
      setUploadNotice('Evidence uploaded successfully.');
      const docs = await api<{ documents: DocumentRow[] }>(`/documents/return/${id}`);
      setDocuments(docs.documents);
    } catch (err) {
      setUploadError(friendlyMessage(err));
    } finally {
      setUploadPending(false);
    }
  }

  async function handleDownload(doc: DocumentRow) {
    setDownloadingId(doc.id);
    setDownloadError(null);
    try {
      const token = getToken();
      const response = await fetch(`/api/v1/documents/${doc.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = doc.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleCancel() {
    if (!id || !detail) return;
    const confirmed = window.confirm(`Cancel return ${detail.ret.return_number}? This cannot be undone.`);
    if (!confirmed) return;
    const reason = window.prompt('Please tell us why you are cancelling (optional):') ?? '';
    setCancelPending(true);
    setCancelError(null);
    try {
      const data = await api<{ ret: ReturnDetailData['ret'] }>(`/returns/${id}/cancel`, {
        method: 'POST',
        body: { reason },
      });
      setDetail({ ...detail, ret: data.ret });
    } catch (err) {
      setCancelError(friendlyMessage(err));
    } finally {
      setCancelPending(false);
    }
  }

  async function handleFeedbackSubmit() {
    if (!id) return;
    setFeedbackPending(true);
    setFeedbackError(null);
    setFeedbackNotice(null);
    try {
      const data = await api<{ feedback: FeedbackRow }>('/feedback', {
        method: 'POST',
        body: { returnId: id, rating, comment: comment.trim() === '' ? undefined : comment.trim() },
      });
      setFeedback(data.feedback);
      setFeedbackNotice('Thank you. Your feedback was submitted.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setFeedbackError('Feedback was already submitted for this return.');
      } else {
        setFeedbackError(friendlyMessage(err));
      }
    } finally {
      setFeedbackPending(false);
    }
  }

  if (loading) return <LoadingState label="Loading return details…" />;
  if (error || !detail) {
    return (
      <div className={styles.page}>
        <Link className={styles.backLink} to="/customer/returns">
          <ArrowLeft size={16} aria-hidden="true" /> Back to returns
        </Link>
        <ErrorState message={error ?? 'Return not found.'} onRetry={() => void loadAll()} />
      </div>
    );
  }

  const { ret, items, pickup, refund, order } = detail;
  const qa = qaForStatus(ret.status, ret.return_number);
  const cancellable = ret.status.toUpperCase() === 'REQUESTED' || ret.status.toUpperCase() === 'APPROVED';
  const feedbackEligible = ret.status.toUpperCase() === 'COMPLETED' || ret.status.toUpperCase() === 'RESOLVED';

  const firstItem = items[0] ?? null;
  const heroName =
    (firstItem?.productName ?? firstItem?.product_name ?? '').trim() !== ''
      ? String(firstItem?.productName ?? firstItem?.product_name)
      : `Return ${ret.return_number}`;
  const heroImage = firstItem ? orderItemImageFor(firstItem) : GENERIC_PRODUCT_IMAGE;
  const heroQuantity = firstItem?.quantity ?? null;
  const heroSku = firstItem?.sku ?? null;
  const orderId = ret.order_id ?? order?.id ?? null;
  const orderNumber = order?.order_number ?? null;

  return (
    <div className={styles.page}>
      <Link className={styles.backLink} to="/customer/returns">
        <ArrowLeft size={16} aria-hidden="true" /> Back to returns
      </Link>
      <PageHead
        kicker="Return detail"
        title={heroName}
        lede={
          heroQuantity !== null
            ? `Quantity ${heroQuantity}${heroSku ? ` · SKU ${heroSku}` : ''}`
            : undefined
        }
        actions={<StatusBadge tone={statusTone(ret.status)}>{ret.status.replaceAll('_', ' ')}</StatusBadge>}
      />

      <section className={styles.panel} aria-label="Return overview">
        <div className={styles.productHero}>
          <img className={styles.productHeroImage} src={heroImage} alt={heroName} loading="lazy" />
          <div>
            <p className={styles.productHeroMeta}>Return ID: {ret.return_number}</p>
            <p className={styles.productHeroMeta}>
              Order: {orderNumber ?? ret.order_id}
              {heroQuantity !== null ? ` · Quantity ${heroQuantity}` : ''}
            </p>
            <div className={styles.metaLinks}>
              {orderId && (
                <Link className={styles.link} to={`/customer/orders/${orderId}`}>
                  View order
                </Link>
              )}
              <Link className={styles.link} to="/customer/support">
                Contact support
              </Link>
            </div>
          </div>
        </div>
        {order && (
          <p className={styles.helper} style={{ marginTop: 8 }}>
            Placed from order {order.order_number} on {formatDate(order.created_at)}.
          </p>
        )}
      </section>

      {created && (
        <p className={styles.banner} role="status">
          Your return request was created successfully. Evidence and status updates will appear on this page.
        </p>
      )}

      <section className={styles.panel} aria-label="Return status overview">
        <div className={styles.qa}>
          <div className={styles.qaItem}>
            <h3>What happened</h3>
            <p>{qa.happened}</p>
          </div>
          <div className={styles.qaItem}>
            <h3>What is happening now</h3>
            <p>{qa.now}</p>
          </div>
          <div className={styles.qaItem}>
            <h3>What happens next</h3>
            <p>{qa.next}</p>
          </div>
          <div className={styles.qaItem}>
            <h3>Anything needed from you</h3>
            <p>{qa.needed}</p>
          </div>
        </div>
      </section>

      <div className={styles.grid}>
        <div className={styles.page}>
          <section className={styles.panel} aria-labelledby="items-h">
            <h2 id="items-h">Returned items</h2>
            {items.length === 0 ? (
              <p className={styles.helper}>No items recorded for this return.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col">Quantity</th>
                      <th scope="col">Reason</th>
                      <th scope="col">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const name =
                        (item.productName ?? item.product_name ?? '').trim() !== ''
                          ? String(item.productName ?? item.product_name)
                          : 'Item';
                      const image = orderItemImageFor(item);
                      const unitPrice =
                        item.unitPrice ?? item.unit_price ?? null;
                      return (
                        <tr key={item.id}>
                          <td>
                            <span className={styles.productRow}>
                              <img className={styles.productThumb} src={image} alt={name} loading="lazy" />
                              <span>
                                <span className={styles.productName}>{name}</span>
                                <br />
                                <span className={styles.productSub}>
                                  {item.sku ?? '—'}
                                  {unitPrice !== null ? ` · ${formatMoney(unitPrice)} each` : ''}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td className={styles.mono}>{item.quantity}</td>
                          <td>{item.reason_code}</td>
                          <td>{item.description ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {ret.description && (
              <>
                <h3>Overall description</h3>
                <p>{ret.description}</p>
              </>
            )}
          </section>

          <section className={styles.panel} aria-labelledby="timeline-h">
            <h2 id="timeline-h">Timeline</h2>
            {timeline.length === 0 ? (
              <p className={styles.helper}>No timeline events yet.</p>
            ) : (
              <ol className={styles.timeline}>
                {timeline.map((event) => (
                  <li key={event.id} className={styles.timelineItem}>
                    <span className={styles.timelineDot} aria-hidden="true" />
                    <div className={styles.timelineBody}>
                      <span className={styles.timelineStatus}>{event.status.replaceAll('_', ' ')}</span>
                      <span className={styles.timelineDate}>{formatDate(event.created_at)}</span>
                      {event.description && <span className={styles.timelineDesc}>{event.description}</span>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className={styles.panel} aria-labelledby="docs-h">
            <h2 id="docs-h">Documents and evidence</h2>
            {documents.length === 0 ? (
              <p className={styles.helper}>No documents uploaded yet.</p>
            ) : (
              <ul className={styles.docList}>
                {documents.map((doc) => (
                  <li key={doc.id} className={styles.docRow}>
                    <span className={styles.docName}>
                      <FileText size={16} aria-hidden="true" />
                      {doc.filename}
                    </span>
                    <span className={styles.docMeta}>
                      {doc.kind} · {formatBytes(doc.size)} · {formatDate(doc.created_at)}
                    </span>
                    <button
                      type="button"
                      className={styles.btn}
                      disabled={downloadingId === doc.id}
                      onClick={() => void handleDownload(doc)}
                    >
                      <Download size={15} aria-hidden="true" />
                      {downloadingId === doc.id ? 'Downloading…' : 'Download'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {downloadError && (
              <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
                {downloadError}
              </p>
            )}

            <div className={styles.form}>
              <label className={styles.label} htmlFor="evidence-file">
                Upload evidence (JPG, PNG, WebP, or PDF, max 5 MB)
              </label>
              <input
                id="evidence-file"
                className={styles.input}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf"
                disabled={uploadPending}
                onChange={(event) => void handleFileSelect(event)}
                aria-describedby="evidence-file-error"
              />
              {uploadPending && (
                <p className={styles.helper} role="status">
                  Uploading…
                </p>
              )}
              <FieldError id="evidence-file-error" message={uploadError} />
              {uploadNotice && (
                <p className={styles.notice} role="status">
                  {uploadNotice}
                </p>
              )}
            </div>
          </section>

          {feedbackEligible && (
            <section className={styles.panel} aria-labelledby="feedback-h">
              <h2 id="feedback-h">Rate this return</h2>
              {!feedbackChecked ? (
                <p className={styles.helper}>Checking for existing feedback…</p>
              ) : feedback ? (
                <p className={styles.notice} role="status">
                  You rated this return {feedback.rating} out of 5
                  {feedback.comment ? ` — “${feedback.comment}”` : '.'} Submitted on {formatDate(feedback.created_at)}.
                </p>
              ) : (
                <div className={styles.form}>
                  <span className={styles.label} id="rating-label">
                    Rating
                  </span>
                  <div className={styles.ratingRow} role="group" aria-labelledby="rating-label">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`${styles.star} ${value <= rating ? styles.starActive : ''}`}
                        aria-pressed={value === rating}
                        aria-label={`Rate ${value} out of 5`}
                        onClick={() => setRating(value)}
                      >
                        <Star size={18} aria-hidden="true" fill={value <= rating ? 'currentColor' : 'none'} />
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className={styles.label} htmlFor="feedback-comment">
                      Comment (optional)
                    </label>
                    <textarea
                      id="feedback-comment"
                      className={styles.textarea}
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      rows={3}
                      maxLength={2000}
                    />
                  </div>
                  <FieldError id="feedback-error" message={feedbackError} />
                  {feedbackNotice && (
                    <p className={styles.notice} role="status">
                      {feedbackNotice}
                    </p>
                  )}
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      disabled={feedbackPending}
                      onClick={() => void handleFeedbackSubmit()}
                    >
                      <Upload size={15} aria-hidden="true" />
                      {feedbackPending ? 'Submitting…' : 'Submit feedback'}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        <div className={styles.page}>
          <section className={styles.panel} aria-labelledby="pickup-h">
            <h2 id="pickup-h">Pickup</h2>
            {!pickup ? (
              <p className={styles.helper}>Pickup details will appear here once arranged.</p>
            ) : (
              <dl className={styles.kv}>
                <div>
                  <dt>Method</dt>
                  <dd>{humanize(pickup.kind)}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{humanize(pickup.status)}</dd>
                </div>
                <div>
                  <dt>Address</dt>
                  <dd>{pickup.address ?? '—'}</dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd>{formatDate(pickup.date)}</dd>
                </div>
                <div>
                  <dt>Time window</dt>
                  <dd>{pickup.time_window ?? '—'}</dd>
                </div>
                <div>
                  <dt>Carrier</dt>
                  <dd>{pickup.carrier ?? '—'}</dd>
                </div>
                <div>
                  <dt>Tracking</dt>
                  <dd className={styles.mono}>{pickup.tracking_number ?? '—'}</dd>
                </div>
              </dl>
            )}
          </section>

          <section className={styles.panel} aria-labelledby="resolution-h">
            <h2 id="resolution-h">Resolution</h2>
            <dl className={styles.kv}>
              <div>
                <dt>Type</dt>
                <dd>{humanize(ret.resolution_type)}</dd>
              </div>
              {refund && (
                <>
                  <div>
                    <dt>Refund kind</dt>
                    <dd>{humanize(refund.kind)}</dd>
                  </div>
                  <div>
                    <dt>Amount</dt>
                    <dd>{formatMoney(refund.amount)}</dd>
                  </div>
                  <div>
                    <dt>Method</dt>
                    <dd>{humanize(refund.method)}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{humanize(refund.status)}</dd>
                  </div>
                  <div>
                    <dt>Initiated</dt>
                    <dd>{formatDate(refund.initiated_at)}</dd>
                  </div>
                  <div>
                    <dt>Completed</dt>
                    <dd>{formatDate(refund.completed_at)}</dd>
                  </div>
                </>
              )}
            </dl>
            {!refund && <p className={styles.helper}>Refund or replacement details will appear here once processed.</p>}
          </section>

          {cancellable && (
            <section className={styles.panel} aria-labelledby="cancel-h">
              <h2 id="cancel-h">Cancel this return</h2>
              <p className={styles.helper}>Cancelling stops the process immediately. This cannot be undone.</p>
              <FieldError id="cancel-error" message={cancelError} />
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={cancelPending}
                  onClick={() => void handleCancel()}
                  aria-describedby="cancel-error"
                >
                  {cancelPending ? 'Cancelling…' : 'Cancel return'}
                </button>
              </div>
            </section>
          )}

          {items.length === 0 && (
            <EmptyState title="No items" body="This return has no line items recorded." />
          )}
        </div>
      </div>
    </div>
  );
}
