import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { ApiError, api, friendlyMessage, uploadFile } from '../../lib/api';
import type {
  DocumentRow,
  EligibleOrderItem,
  MetaConstants,
  OrderDetail,
  OrderRow,
  ReasonRow,
  ReturnDetail as ReturnDetailData,
} from '../../lib/api';
import { EmptyState, ErrorState, FieldError, LoadingState, PageHead } from '../../components/ui';
import { orderItemImageFor } from '../../lib/productImage';
import styles from './newreturn.module.css';

const STEP_NAMES = ['Order', 'Items', 'Reason', 'Details', 'Evidence', 'Resolution', 'Review', 'Submit'];
const DRAFT_KEY = 'returnos.newreturn.draft.v1';
const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function formatMoney(value: number): string {
  return inr.format(value);
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

interface Draft {
  orderId: string;
  quantities: Record<string, number>;
  reasons: Record<string, string>;
  itemNotes: Record<string, string>;
  overall: string;
  resolutionType: string;
  pickupKind: string;
  pickupAddress: string;
  pickupDate: string;
  timeWindow: string;
  step: number;
}

const EMPTY_DRAFT: Draft = {
  orderId: '',
  quantities: {},
  reasons: {},
  itemNotes: {},
  overall: '',
  resolutionType: '',
  pickupKind: '',
  pickupAddress: '',
  pickupDate: '',
  timeWindow: '',
  step: 0,
};

function loadDraft(): Draft {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return {
      ...EMPTY_DRAFT,
      ...parsed,
      quantities: parsed.quantities ?? {},
      reasons: parsed.reasons ?? {},
      itemNotes: parsed.itemNotes ?? {},
      step: typeof parsed.step === 'number' ? Math.min(Math.max(parsed.step, 0), 7) : 0,
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

interface StagedFile {
  id: string;
  file: File;
}

let stagedCounter = 0;
function nextStagedId(): string {
  stagedCounter += 1;
  return `staged-${Date.now()}-${stagedCounter}`;
}

/**
 * Product names + thumbnail for one order option. The /orders list payload
 * carries no line items, so each row loads its own detail (same pattern as
 * the My Orders list) and falls back to the order number while loading.
 * The thumbnail is decorative: the product name next to it carries the meaning.
 */
function OrderPickVisual({ orderId, fallback }: { orderId: string; fallback: string }) {
  const [items, setItems] = useState<OrderDetail['items'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<OrderDetail>(`/orders/${orderId}`)
      .then((data) => {
        if (!cancelled) setItems(data.items);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (!items || items.length === 0) {
    return <span className={styles.pickTitle}>{fallback}</span>;
  }
  const first = items[0];
  const extra = items.length - 1;
  return (
    <span className={styles.pickVisual}>
      <img className={styles.pickThumb} src={orderItemImageFor(first)} alt="" aria-hidden="true" loading="lazy" />
      <span className={styles.pickTitle}>
        {first.product_name}
        {extra > 0 && <span className={styles.pickMore}> +{extra} more</span>}
      </span>
    </span>
  );
}

/** Map a server validation path to the wizard step that owns it. */
function stepForPath(path: string): number {
  if (path === 'orderId' || path === 'order') return 0;
  if (path.startsWith('items')) {
    if (path.includes('reasonCode')) return 2;
    if (path.includes('description')) return 3;
    return 1;
  }
  if (path === 'description') return 3;
  if (path === 'resolutionType' || path.startsWith('pickup') || path === 'timeWindow') return 5;
  return 6;
}

export default function NewReturn() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectOrderId = searchParams.get('orderId') ?? '';
  const preselectItemId = searchParams.get('itemId') ?? '';

  const [initial] = useState<Draft>(() => {
    const draft = loadDraft();
    if (preselectOrderId && !draft.orderId) draft.orderId = preselectOrderId;
    return draft;
  });

  const [step, setStep] = useState(initial.step);
  const [orderId, setOrderId] = useState(initial.orderId || preselectOrderId);
  const [quantities, setQuantities] = useState<Record<string, number>>(initial.quantities);
  const [reasons, setReasons] = useState<Record<string, string>>(initial.reasons);
  const [itemNotes, setItemNotes] = useState<Record<string, string>>(initial.itemNotes);
  const [overall, setOverall] = useState(initial.overall);
  const [pickedResolution, setResolutionType] = useState(initial.resolutionType);
  const [pickupKind, setPickupKind] = useState(initial.pickupKind);
  const [pickupAddress, setPickupAddress] = useState(initial.pickupAddress);
  const [pickupDate, setPickupDate] = useState(initial.pickupDate);
  const [timeWindow, setTimeWindow] = useState(initial.timeWindow);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [stageError, setStageError] = useState<string | null>(null);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  const [reasonRows, setReasonRows] = useState<ReasonRow[]>([]);
  const [constants, setConstants] = useState<MetaConstants | null>(null);

  const [stepError, setStepError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // Persist the draft (files cannot be stored, everything else is restored).
  useEffect(() => {
    try {
      const draft: Draft = {
        orderId,
        quantities,
        reasons,
        itemNotes,
        overall,
        resolutionType: pickedResolution,
        pickupKind,
        pickupAddress,
        pickupDate,
        timeWindow,
        step,
      };
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* storage unavailable — the wizard still works for this session */
    }
  }, [orderId, quantities, reasons, itemNotes, overall, pickedResolution, pickupKind, pickupAddress, pickupDate, timeWindow, step]);

  useEffect(() => {
    let alive = true;
    async function loadOrders() {
      setOrdersLoading(true);
      setOrdersError(null);
      try {
        const data = await api<{ orders: OrderRow[] }>('/orders');
        if (alive) setOrders(data.orders);
      } catch (err) {
        if (alive) setOrdersError(friendlyMessage(err));
      } finally {
        if (alive) setOrdersLoading(false);
      }
    }
    void loadOrders();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadOrder() {
      if (!orderId) {
        setOrderDetail(null);
        return;
      }
      setOrderLoading(true);
      setOrderError(null);
      try {
        const data = await api<OrderDetail>(`/orders/${orderId}`);
        if (!alive) return;
        setOrderDetail(data);
        if (preselectItemId) {
          const match = data.items.find((item) => item.id === preselectItemId);
          if (match && match.remaining_quantity > 0) {
            setQuantities((prev) => (prev[match.id] === undefined ? { ...prev, [match.id]: 1 } : prev));
          }
        }
      } catch (err) {
        if (alive) {
          setOrderError(friendlyMessage(err));
          setOrderDetail(null);
        }
      } finally {
        if (alive) setOrderLoading(false);
      }
    }
    void loadOrder();
    return () => {
      alive = false;
    };
  }, [orderId, preselectItemId]);

  useEffect(() => {
    let alive = true;
    async function loadMeta() {
      try {
        // Business rules (resolution types, pickup kinds, return window) come
        // from the backend only. There is deliberately no local fallback: a
        // stale client-side copy of a money-or-policy rule is worse than an error.
        const [reasonData, constantData] = await Promise.all([
          api<{ reasons: ReasonRow[] }>('/meta/reasons'),
          api<MetaConstants>('/meta/constants'),
        ]);
        if (alive) {
          setReasonRows(reasonData.reasons);
          setConstants(constantData);
        }
      } catch {
        if (alive) setReasonRows([]);
      }
    }
    void loadMeta();
    return () => {
      alive = false;
    };
  }, []);

  const eligibleItems: EligibleOrderItem[] = useMemo(
    () => (orderDetail ? orderDetail.items.filter((item) => item.remaining_quantity > 0) : []),
    [orderDetail],
  );

  const selectedIds = useMemo(() => Object.keys(quantities).filter((key) => (quantities[key] ?? 0) > 0), [quantities]);

  /**
   * Resolutions the backend will accept for the reasons chosen so far: the
   * intersection across every selected line. Rules live server-side; this only
   * intersects the published map so the customer never picks an option that
   * would be rejected on submit.
   */
  const availableResolutions = useMemo<string[]>(() => {
    const catalogue = constants?.resolutionTypes ?? [];
    const rules = orderDetail?.resolutionsByReason;
    if (!rules) return catalogue;
    const chosenReasons = selectedIds.map((itemId) => reasons[itemId]).filter((code): code is string => Boolean(code));
    if (chosenReasons.length === 0) return catalogue;
    return catalogue.filter((option) => chosenReasons.every((code) => (rules[code] ?? catalogue).includes(option)));
  }, [constants, orderDetail, selectedIds, reasons]);

  // A resolution the chosen reasons no longer permit simply stops counting as
  // selected. Derived rather than reset in an effect, so the review step and the
  // submitted payload can never disagree with the server's rules.
  const resolutionType = availableResolutions.includes(pickedResolution) ? pickedResolution : '';

  function selectedItems(): Array<{ item: EligibleOrderItem; quantity: number }> {
    if (!orderDetail) return [];
    return selectedIds
      .map((id) => orderDetail.items.find((item) => item.id === id))
      .filter((item): item is EligibleOrderItem => item !== undefined)
      .map((item) => ({ item, quantity: quantities[item.id] ?? 0 }));
  }

  function validateStep(current: number): string | null {
    switch (current) {
      case 0:
        if (!orderId) return 'Select an order to continue.';
        if (orderDetail && !orderDetail.eligible) {
          return orderDetail.ineligibleReason ?? 'This order is no longer eligible for returns.';
        }
        return null;
      case 1:
        if (selectedIds.length === 0) return 'Select at least one item and set a quantity.';
        return null;
      case 2: {
        const missing = selectedItems().filter((entry) => !reasons[entry.item.id]);
        if (missing.length > 0) return 'Choose a reason for every selected item.';
        return null;
      }
      case 3:
        return null;
      case 4:
        return null;
      case 5:
        if (!resolutionType) return 'Choose how you want this return resolved.';
        if (!pickupKind) return 'Choose pickup or drop-off.';
        if (pickupKind === 'PICKUP' && pickupAddress.trim() === '') return 'Enter the pickup address.';
        return null;
      default:
        return null;
    }
  }

  function goNext() {
    const problem = validateStep(step);
    setStepError(problem);
    if (problem) return;
    setStep((prev) => Math.min(prev + 1, 7));
  }

  function goBack() {
    setStepError(null);
    setStep((prev) => Math.max(prev - 1, 0));
  }

  function setQuantity(item: EligibleOrderItem, value: number) {
    const clamped = Math.min(Math.max(value, 0), item.remaining_quantity);
    setQuantities((prev) => {
      if (clamped === 0) {
        const next = { ...prev };
        delete next[item.id];
        return next;
      }
      return { ...prev, [item.id]: clamped };
    });
  }

  function handleStageFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    setStageError(null);
    const additions: StagedFile[] = [];
    for (const file of files) {
      if (!ACCEPTED_MIME.has(file.type)) {
        setStageError(`"${file.name}" is not accepted. Use JPG, PNG, WebP, or PDF.`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        setStageError(`"${file.name}" is larger than 5 MB.`);
        continue;
      }
      additions.push({ id: nextStagedId(), file });
    }
    if (additions.length > 0) setStaged((prev) => [...prev, ...additions]);
  }

  async function handleSubmit() {
    const problems: Array<{ index: number; message: string }> = [];
    for (let index = 0; index <= 5; index += 1) {
      const problem = validateStep(index);
      if (problem) problems.push({ index, message: problem });
    }
    if (problems.length > 0) {
      const first = problems[0];
      setStep(first.index);
      setStepError(first.message);
      return;
    }
    setSubmitting(true);
    setServerErrors({});
    setServerMessage(null);
    setUploadProgress(null);
    try {
      const body = {
        orderId,
        items: selectedItems().map((entry) => ({
          orderItemId: entry.item.id,
          quantity: entry.quantity,
          reasonCode: reasons[entry.item.id],
          description: (itemNotes[entry.item.id] ?? '').trim() === '' ? undefined : itemNotes[entry.item.id].trim(),
        })),
        resolutionType,
        description: overall.trim() === '' ? undefined : overall.trim(),
        pickupKind,
        pickupAddress: pickupAddress.trim() === '' ? undefined : pickupAddress.trim(),
        pickupDate: pickupDate === '' ? undefined : pickupDate,
        timeWindow: timeWindow.trim() === '' ? undefined : timeWindow.trim(),
      };
      const created = await api<ReturnDetailData>('/returns', { method: 'POST', body });

      if (staged.length > 0) {
        let done = 0;
        for (const entry of staged) {
          setUploadProgress(`Uploading evidence ${done + 1} of ${staged.length}…`);
          await uploadFile<{ document: DocumentRow }>(`/uploads/return/${created.ret.id}`, entry.file, {
            kind: 'EVIDENCE',
          });
          done += 1;
        }
        setUploadProgress(null);
      }

      try {
        window.sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      navigate(`/customer/returns/${created.ret.id}`, { state: { created: true } });
    } catch (err) {
      if (err instanceof ApiError && err.errors && err.errors.length > 0) {
        const mapped: Record<string, string> = {};
        let earliest = 7;
        for (const entry of err.errors) {
          mapped[entry.path] = entry.message;
          earliest = Math.min(earliest, stepForPath(entry.path));
        }
        setServerErrors(mapped);
        setServerMessage(err.message);
        setStep(earliest);
      } else {
        setServerMessage(friendlyMessage(err));
        setStep(7);
      }
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  }

  function errorsFor(prefix: string): string[] {
    return Object.entries(serverErrors)
      .filter(([path]) => path.startsWith(prefix))
      .map(([, message]) => message);
  }

  if (ordersLoading) return <LoadingState label="Loading your orders…" />;
  if (ordersError) {
    return (
      <div className={styles.page}>
        <PageHead kicker="New return" title="Start a return" />
        <ErrorState message={ordersError} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHead
        kicker="New return"
        title="Start a return"
        lede="Answer a few questions and we will arrange the rest. Your progress is saved on this device."
      />

      <ol className={styles.progress} aria-label="Return request progress">
        {STEP_NAMES.map((name, index) => (
          <li
            key={name}
            className={`${styles.progressItem} ${index === step ? styles.progressCurrent : ''} ${index < step ? styles.progressDone : ''}`}
            aria-current={index === step ? 'step' : undefined}
          >
            <span className={styles.progressNum} aria-hidden="true">
              {index < step ? <Check size={13} /> : index + 1}
            </span>
            {name}
          </li>
        ))}
      </ol>
      <div className={styles.progressBar} role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={8} aria-label="Wizard progress">
        <div className={styles.progressFill} style={{ width: `${((step + 1) / 8) * 100}%` }} />
      </div>

      {serverMessage && (
        <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
          {serverMessage}
        </p>
      )}

      {step === 0 && (
        <section className={styles.panel} aria-labelledby="step-order">
          <h2 id="step-order">Step 1 of 8: Select an order</h2>
          <p className={styles.panelLede}>Choose the order that contains the items you want to return.</p>
          {orders.length === 0 ? (
            <EmptyState title="No orders found" body="Orders you place will appear here and become eligible for returns." />
          ) : (
            <ul className={styles.list}>
              {orders.map((order) => (
                <li key={order.id}>
                  <button
                    type="button"
                    className={`${styles.pick} ${orderId === order.id ? styles.pickSelected : ''}`}
                    aria-pressed={orderId === order.id}
                    onClick={() => {
                      setOrderId(order.id);
                      setStepError(null);
                    }}
                  >
                    <span className={styles.pickMain}>
                      <OrderPickVisual orderId={order.id} fallback={order.order_number} />
                      <br />
                      <span className={styles.pickSub}>
                        {order.status} · {formatMoney(order.subtotal)} · {formatDate(order.delivered_at ?? order.created_at)} · {order.order_number}
                      </span>
                    </span>
                    {orderId === order.id && <Check size={18} aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {orderLoading && <p className={styles.panelLede}>Checking eligibility…</p>}
          {orderError && (
            <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
              {orderError}
            </p>
          )}
          {orderDetail && !orderDetail.eligible && (
            <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
              {orderDetail.ineligibleReason ?? 'This order is not eligible for a new return.'} Please choose another order.
            </p>
          )}
          {orderDetail?.eligible && orderDetail.eligibleUntil !== null && (
            <p className={styles.notice}>Eligible until {formatDate(orderDetail.eligibleUntil)}</p>
          )}
          {errorsFor('orderId').map((message) => (
            <p key={message} className={`${styles.notice} ${styles.noticeError}`} role="alert">
              {message}
            </p>
          ))}
        </section>
      )}

      {step === 1 && (
        <section className={styles.panel} aria-labelledby="step-items">
          <h2 id="step-items">Step 2 of 8: Select items</h2>
          <p className={styles.panelLede}>Set how many units of each item to return. Quantities cannot exceed what is still returnable.</p>
          {!orderDetail ? (
            <p className={styles.panelLede}>Select an order first.</p>
          ) : eligibleItems.length === 0 ? (
            <EmptyState title="Nothing left to return" body="Every item on this order has already been returned or is ineligible." />
          ) : (
            <ul className={styles.list}>
              {orderDetail.items.map((item) => {
                const qty = quantities[item.id] ?? 0;
                const exhausted = item.remaining_quantity <= 0;
                return (
                  <li key={item.id} className={styles.itemCard}>
                    <div className={styles.itemTop}>
                      <div>
                        <div className={styles.pickTitle}>{item.product_name}</div>
                        <div className={styles.pickSub}>
                          {item.sku} · {formatMoney(item.unit_price)} each · {item.remaining_quantity} of {item.quantity} returnable
                        </div>
                      </div>
                      {exhausted ? (
                        <span className={`${styles.badge} ${styles.badgeBad}`}>
                          {item.ineligibleReason ?? 'Not eligible'}
                        </span>
                      ) : (
                        <div className={styles.stepper}>
                          <button
                            type="button"
                            className={styles.stepperBtn}
                            aria-label={`Decrease quantity for ${item.product_name}`}
                            disabled={qty <= 0}
                            onClick={() => setQuantity(item, qty - 1)}
                          >
                            −
                          </button>
                          <span className={styles.stepperValue} aria-live="polite" aria-label={`Selected quantity for ${item.product_name}`}>
                            {qty}
                          </span>
                          <button
                            type="button"
                            className={styles.stepperBtn}
                            aria-label={`Increase quantity for ${item.product_name}`}
                            disabled={qty >= item.remaining_quantity}
                            onClick={() => setQuantity(item, qty + 1)}
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {errorsFor('items').map((message) => (
            <p key={message} className={`${styles.notice} ${styles.noticeError}`} role="alert">
              {message}
            </p>
          ))}
        </section>
      )}

      {step === 2 && (
        <section className={styles.panel} aria-labelledby="step-reason">
          <h2 id="step-reason">Step 3 of 8: Reason per item</h2>
          <p className={styles.panelLede}>Tell us why each item is going back. This helps the warehouse inspect it correctly.</p>
          {reasonRows.length === 0 ? (
            <p className={styles.panelLede}>Reason codes could not be loaded. You can still continue and describe the issue next.</p>
          ) : (
            <div className={styles.form}>
              {selectedItems().map((entry) => (
                <fieldset key={entry.item.id} className={styles.itemCard}>
                  <legend className={styles.pickTitle}>
                    {entry.item.product_name} × {entry.quantity}
                  </legend>
                  <div className={styles.radioGroup} role="radiogroup" aria-label={`Reason for ${entry.item.product_name}`}>
                    {reasonRows.map((reason) => (
                      <label key={reason.code} className={`${styles.radio} ${reasons[entry.item.id] === reason.code ? styles.radioChecked : ''}`}>
                        <input
                          type="radio"
                          name={`reason-${entry.item.id}`}
                          value={reason.code}
                          checked={reasons[entry.item.id] === reason.code}
                          onChange={() => setReasons((prev) => ({ ...prev, [entry.item.id]: reason.code }))}
                        />
                        <span>
                          <span className={styles.radioTitle}>{reason.label}</span>
                          {reason.description && (
                            <>
                              <br />
                              <span className={styles.radioDesc}>{reason.description}</span>
                            </>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                  {serverErrors[`items`] && <FieldError id={`server-items-${entry.item.id}`} message={serverErrors[`items`]} />}
                </fieldset>
              ))}
            </div>
          )}
        </section>
      )}

      {step === 3 && (
        <section className={styles.panel} aria-labelledby="step-details">
          <h2 id="step-details">Step 4 of 8: Describe the issue</h2>
          <p className={styles.panelLede}>Optional, but a short description speeds up inspection. Add a note per item and one overall summary.</p>
          <div className={styles.form}>
            {selectedItems().map((entry) => (
              <div key={entry.item.id} className={styles.field}>
                <label className={styles.label} htmlFor={`note-${entry.item.id}`}>
                  Note for {entry.item.product_name} (optional)
                </label>
                <textarea
                  id={`note-${entry.item.id}`}
                  className={styles.textarea}
                  value={itemNotes[entry.item.id] ?? ''}
                  onChange={(event) => setItemNotes((prev) => ({ ...prev, [entry.item.id]: event.target.value }))}
                  rows={2}
                  maxLength={2000}
                />
              </div>
            ))}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="overall-note">
                Overall description (optional)
              </label>
              <textarea
                id="overall-note"
                className={styles.textarea}
                value={overall}
                onChange={(event) => setOverall(event.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="Example: the parcel arrived with a torn box and one unit does not switch on."
              />
            </div>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className={styles.panel} aria-labelledby="step-evidence">
          <h2 id="step-evidence">Step 5 of 8: Upload evidence</h2>
          <p className={styles.panelLede}>
            Optional. Photos or a short PDF (JPG, PNG, WebP, PDF, max 5 MB each) help us approve faster. Files are
            uploaded after your return is created, or you can skip this step.
          </p>
          <div className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="evidence-input">
                Choose files
              </label>
              <input
                id="evidence-input"
                className={styles.input}
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.pdf"
                onChange={handleStageFiles}
                aria-describedby="evidence-input-error"
              />
              <FieldError id="evidence-input-error" message={stageError} />
            </div>
            {staged.length > 0 && (
              <ul className={styles.list} aria-label="Staged files">
                {staged.map((entry) => (
                  <li key={entry.id} className={styles.fileRow}>
                    <span className={styles.fileName}>
                      {entry.file.name} · {(entry.file.size / 1024).toFixed(0)} KB
                    </span>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      aria-label={`Remove ${entry.file.name}`}
                      onClick={() => setStaged((prev) => prev.filter((row) => row.id !== entry.id))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {step === 5 && (
        <section className={styles.panel} aria-labelledby="step-resolution">
          <h2 id="step-resolution">Step 6 of 8: Resolution and pickup</h2>
          <p className={styles.panelLede}>Choose how the return should be resolved and how the items reach us.</p>
          <div className={styles.form}>
            <fieldset className={styles.itemCard}>
              <legend className={styles.label}>Resolution type</legend>
              <div className={styles.cards} role="radiogroup" aria-label="Resolution type">
                {availableResolutions.map((option) => (
                  <label key={option} className={`${styles.radio} ${resolutionType === option ? styles.radioChecked : ''}`}>
                    <input
                      type="radio"
                      name="resolution-type"
                      value={option}
                      checked={resolutionType === option}
                      onChange={() => setResolutionType(option)}
                    />
                    <span className={styles.radioTitle}>{option.replaceAll('_', ' ')}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className={styles.itemCard}>
              <legend className={styles.label}>Pickup method</legend>
              <div className={styles.cards} role="radiogroup" aria-label="Pickup method">
                {(constants?.pickupKinds ?? []).map((option) => (
                  <label key={option} className={`${styles.radio} ${pickupKind === option ? styles.radioChecked : ''}`}>
                    <input type="radio" name="pickup-kind" value={option} checked={pickupKind === option} onChange={() => setPickupKind(option)} />
                    <span className={styles.radioTitle}>{option.replaceAll('_', ' ')}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="pickup-address">
                {pickupKind === 'DROP_OFF' ? 'Address note (optional)' : 'Pickup address'}
              </label>
              <textarea
                id="pickup-address"
                className={styles.textarea}
                value={pickupAddress}
                onChange={(event) => setPickupAddress(event.target.value)}
                rows={2}
                placeholder="Flat, street, city, postal code, phone"
              />
            </div>
            <div className={styles.grid2}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="pickup-date">
                  Preferred date (optional)
                </label>
                <input
                  id="pickup-date"
                  className={styles.input}
                  type="date"
                  value={pickupDate}
                  onChange={(event) => setPickupDate(event.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="time-window">
                  Time window (optional)
                </label>
                <input
                  id="time-window"
                  className={styles.input}
                  type="text"
                  value={timeWindow}
                  onChange={(event) => setTimeWindow(event.target.value)}
                  placeholder="Example: 10:00–13:00"
                  maxLength={120}
                />
              </div>
            </div>
          </div>
          {errorsFor('resolutionType').map((message) => (
            <p key={message} className={`${styles.notice} ${styles.noticeError}`} role="alert">
              {message}
            </p>
          ))}
        </section>
      )}

      {step === 6 && (
        <section className={styles.panel} aria-labelledby="step-review">
          <h2 id="step-review">Step 7 of 8: Review</h2>
          <p className={styles.panelLede}>Check everything before submitting. Use Back to fix any step.</p>
          <div>
            <div className={styles.reviewRow}>
              <span className={styles.reviewLabel}>Order</span>
              <span className={`${styles.reviewValue} ${styles.mono}`}>{orderDetail?.order.order_number ?? orderId}</span>
            </div>
            {selectedItems().map((entry) => (
              <div key={entry.item.id} className={styles.reviewRow}>
                <span className={styles.reviewLabel}>
                  {entry.item.product_name} × {entry.quantity} · {reasons[entry.item.id] ?? 'no reason'}
                </span>
                <span className={styles.reviewValue}>{formatMoney(entry.item.unit_price * entry.quantity)}</span>
              </div>
            ))}
            <div className={styles.reviewRow}>
              <span className={styles.reviewLabel}>Resolution</span>
              <span className={styles.reviewValue}>{resolutionType.replaceAll('_', ' ')}</span>
            </div>
            <div className={styles.reviewRow}>
              <span className={styles.reviewLabel}>Pickup</span>
              <span className={styles.reviewValue}>
                {pickupKind.replaceAll('_', ' ')}
                {pickupAddress.trim() !== '' ? ` · ${pickupAddress.trim()}` : ''}
                {pickupDate !== '' ? ` · ${pickupDate}` : ''}
                {timeWindow.trim() !== '' ? ` · ${timeWindow.trim()}` : ''}
              </span>
            </div>
            <div className={styles.reviewRow}>
              <span className={styles.reviewLabel}>Evidence files</span>
              <span className={styles.reviewValue}>{staged.length === 0 ? 'None' : `${staged.length} file(s), uploaded after creation`}</span>
            </div>
            {overall.trim() !== '' && (
              <div className={styles.reviewRow}>
                <span className={styles.reviewLabel}>Description</span>
                <span className={styles.reviewValue}>{overall.trim()}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {step === 7 && (
        <section className={styles.panel} aria-labelledby="step-submit">
          <h2 id="step-submit">Step 8 of 8: Submit</h2>
          <p className={styles.panelLede}>
            Submitting creates the return immediately. Any staged evidence uploads right after, then you land on the
            return detail page.
          </p>
          {uploadProgress && (
            <p className={styles.notice} role="status">
              {uploadProgress}
            </p>
          )}
          <div className={styles.form}>
            <div>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={submitting} onClick={() => void handleSubmit()}>
                <Check size={16} aria-hidden="true" />
                {submitting ? 'Submitting…' : 'Submit return request'}
              </button>
            </div>
          </div>
        </section>
      )}

      {stepError && (
        <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
          {stepError}
        </p>
      )}

      <div className={styles.nav}>
        {step === 0 ? (
          <Link className={styles.btn} to="/customer/returns">
            <ArrowLeft size={16} aria-hidden="true" /> Cancel
          </Link>
        ) : (
          <button type="button" className={styles.btn} onClick={goBack} disabled={submitting}>
            <ArrowLeft size={16} aria-hidden="true" /> Back
          </button>
        )}
        {step < 7 ? (
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={goNext}>
            Next <ArrowRight size={16} aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className={styles.btn} onClick={goBack} disabled={submitting}>
            <ArrowLeft size={16} aria-hidden="true" /> Review again
          </button>
        )}
      </div>
    </div>
  );
}
