import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Save, Wallet } from 'lucide-react';
import { api, friendlyMessage } from '../../lib/api';
import type { CreditState } from '../../lib/api';
import { EmptyState, ErrorState, FieldError, LoadingState, PageHead } from '../../components/ui';
import styles from './profile.module.css';

interface ProfileUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

interface ProfileBody {
  phone: string | null;
}

interface ProfileResponse {
  user: ProfileUser;
  profile: ProfileBody;
}

function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export default function Profile() {
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [credit, setCredit] = useState<CreditState | null>(null);
  const [creditLoading, setCreditLoading] = useState(true);
  const [creditError, setCreditError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<ProfileResponse>('/profile');
      setUser(data.user);
      setFullName(data.user.fullName);
      setPhone(data.profile.phone ?? '');
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadCredit() {
      setCreditLoading(true);
      setCreditError(null);
      try {
        const data = await api<CreditState>('/credit');
        if (alive) setCredit(data);
      } catch (err) {
        if (alive) setCreditError(friendlyMessage(err));
      } finally {
        if (alive) setCreditLoading(false);
      }
    }
    void loadCredit();
    return () => {
      alive = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const problems: Record<string, string> = {};
    if (fullName.trim() === '') problems.fullName = 'Enter your full name.';
    if (phone.trim() !== '' && !/^[+\d][\d\s-]{5,18}$/.test(phone.trim())) {
      problems.phone = 'Enter a valid phone number.';
    }
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setSaving(true);
    setSaveError(null);
    setNotice(null);
    try {
      const data = await api<ProfileResponse>('/profile', {
        method: 'PATCH',
        body: {
          fullName: fullName.trim(),
          phone: phone.trim() === '' ? undefined : phone.trim(),
        },
      });
      setUser(data.user);
      setFullName(data.user.fullName);
      setPhone(data.profile.phone ?? '');
      setNotice('Profile updated successfully.');
    } catch (err) {
      setSaveError(friendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <PageHead kicker="Account" title="Profile" lede="Keep your contact details up to date for pickup coordination." />

      {loading ? (
        <LoadingState label="Loading profile…" />
      ) : error || !user ? (
        <ErrorState message={error ?? 'Profile could not be loaded.'} onRetry={() => void load()} />
      ) : (
        <>
          {notice && (
            <p className={`${styles.notice} ${styles.noticeOk}`} role="status">
              {notice}
            </p>
          )}
          <section className={styles.panel} aria-labelledby="profile-form-h">
            <h2 id="profile-form-h">Personal details</h2>
            <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="profile-email">
                  Email
                </label>
                <input id="profile-email" className={styles.input} type="email" value={user.email} disabled aria-readonly="true" />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="profile-name">
                  Full name
                </label>
                <input
                  id="profile-name"
                  className={styles.input}
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  aria-describedby="profile-name-error"
                  maxLength={120}
                  autoComplete="name"
                />
                <FieldError id="profile-name-error" message={fieldErrors.fullName ?? null} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="profile-phone">
                  Phone (optional)
                </label>
                <input
                  id="profile-phone"
                  className={styles.input}
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  aria-describedby="profile-phone-error"
                  maxLength={24}
                  autoComplete="tel"
                />
                <FieldError id="profile-phone-error" message={fieldErrors.phone ?? null} />
              </div>
              {saveError && (
                <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
                  {saveError}
                </p>
              )}
              <div className={styles.actions}>
                <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}>
                  <Save size={16} aria-hidden="true" />
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </section>

          <section className={styles.panel} aria-labelledby="credit-h">
            <h2 id="credit-h">
              <Wallet size={16} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Store Credit
            </h2>
            {creditLoading ? (
              <LoadingState label="Loading store credit" />
            ) : creditError || !credit ? (
              <ErrorState
                message={creditError ?? 'Store credit could not be loaded.'}
                onRetry={() => {
                  setCreditLoading(true);
                  setCreditError(null);
                  void api<CreditState>('/credit')
                    .then((data) => {
                      setCredit(data);
                      setCreditLoading(false);
                    })
                    .catch((err: unknown) => {
                      setCreditError(friendlyMessage(err));
                      setCreditLoading(false);
                    });
                }}
              />
            ) : (
              <>
                <div className={styles.balanceCard} role="status">
                  <div className={styles.balanceLabel}>Available balance</div>
                  <div className={styles.balanceValue}>{formatPaise(credit.balancePaise)}</div>
                </div>
                {credit.history.length === 0 ? (
                  <EmptyState
                    title="No credit activity"
                    body="Store credit earned from refunds will appear here with its history."
                  />
                ) : (
                  <ul className={styles.historyList}>
                    {credit.history.map((entry) => (
                      <li key={entry.id} className={styles.historyRow}>
                        <div className={styles.historyMain}>
                          <div className={styles.historyReason}>{entry.reason ?? entry.type}</div>
                          <div className={styles.historyMeta}>
                            {entry.type}
                            {entry.referenceType ? ` · ${entry.referenceType}` : ''}
                            {entry.referenceId ? ` ${entry.referenceId}` : ''} · {formatDate(entry.createdAt)}
                          </div>
                        </div>
                        <span className={entry.amountPaise < 0 ? styles.amountNeg : styles.amountPos}>
                          {entry.amountPaise < 0 ? '−' : '+'}
                          {formatPaise(Math.abs(entry.amountPaise))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
