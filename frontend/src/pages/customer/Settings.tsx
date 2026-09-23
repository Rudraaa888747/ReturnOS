import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Lock, Save } from 'lucide-react';
import { api, friendlyMessage } from '../../lib/api';
import { ErrorState, FieldError, LoadingState, PageHead } from '../../components/ui';
import styles from './settings.module.css';

interface PrefsResponse {
  user: { id: string; email: string; fullName: string; role: string };
  profile: {
    phone: string | null;
    commPrefs?: Record<string, boolean>;
    notifPrefs?: Record<string, boolean>;
    comm_prefs?: string;
    notif_prefs?: string;
  };
}

function parsePrefs<T extends Record<string, boolean>>(value: Record<string, boolean> | string | undefined, defaults: T): T {
  if (value && typeof value === 'object') return { ...defaults, ...value };
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value) as Partial<T>;
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  }
  return defaults;
}

const COMM_DEFAULTS = { emailUpdates: true, smsUpdates: false, marketing: false };
const NOTIF_DEFAULTS = { returnUpdates: true, pickupReminders: true, refundAlerts: true };

const COMM_FIELDS: Array<{ key: keyof typeof COMM_DEFAULTS; title: string; hint: string }> = [
  { key: 'emailUpdates', title: 'Email updates', hint: 'Return status changes sent to your email address.' },
  { key: 'smsUpdates', title: 'SMS updates', hint: 'Short text messages for pickup and delivery events.' },
  { key: 'marketing', title: 'Marketing messages', hint: 'Occasional offers and product news. Off by default.' },
];

const NOTIF_FIELDS: Array<{ key: keyof typeof NOTIF_DEFAULTS; title: string; hint: string }> = [
  { key: 'returnUpdates', title: 'Return updates', hint: 'Notify me whenever a return changes status.' },
  { key: 'pickupReminders', title: 'Pickup reminders', hint: 'Remind me before a scheduled pickup.' },
  { key: 'refundAlerts', title: 'Refund alerts', hint: 'Notify me when a refund is initiated or completed.' },
];

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [comm, setComm] = useState(COMM_DEFAULTS);
  const [notif, setNotif] = useState(NOTIF_DEFAULTS);
  const [commSaving, setCommSaving] = useState(false);
  const [notifSaving, setNotifSaving] = useState(false);
  const [commNotice, setCommNotice] = useState<string | null>(null);
  const [notifNotice, setNotifNotice] = useState<string | null>(null);
  const [commError, setCommError] = useState<string | null>(null);
  const [notifError, setNotifError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<PrefsResponse>('/profile');
      setComm(parsePrefs(data.profile.commPrefs, COMM_DEFAULTS));
      setNotif(parsePrefs(data.profile.notifPrefs, NOTIF_DEFAULTS));
      if (!data.profile.commPrefs && data.profile.comm_prefs) {
        setComm(parsePrefs(data.profile.comm_prefs, COMM_DEFAULTS));
      }
      if (!data.profile.notifPrefs && data.profile.notif_prefs) {
        setNotif(parsePrefs(data.profile.notif_prefs, NOTIF_DEFAULTS));
      }
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCommSave() {
    setCommSaving(true);
    setCommError(null);
    setCommNotice(null);
    try {
      await api<unknown>('/profile/settings', { method: 'PATCH', body: { commPrefs: comm } });
      setCommNotice('Communication preferences saved.');
    } catch (err) {
      setCommError(friendlyMessage(err));
    } finally {
      setCommSaving(false);
    }
  }

  async function handleNotifSave() {
    setNotifSaving(true);
    setNotifError(null);
    setNotifNotice(null);
    try {
      await api<unknown>('/profile/settings', { method: 'PATCH', body: { notifPrefs: notif } });
      setNotifNotice('Notification preferences saved.');
    } catch (err) {
      setNotifError(friendlyMessage(err));
    } finally {
      setNotifSaving(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordNotice(null);
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match. Check both fields and try again.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('The new password must be at least 8 characters long.');
      return;
    }
    setPasswordSaving(true);
    try {
      await api<unknown>('/profile/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordNotice('Password changed successfully.');
    } catch (err) {
      setPasswordError(friendlyMessage(err));
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <PageHead kicker="Account" title="Settings" lede="Control how we reach you and keep your account secure." />

      {loading ? (
        <LoadingState label="Loading settings…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        <>
          <section className={styles.panel} aria-labelledby="comm-h">
            <h2 id="comm-h">Communication preferences</h2>
            <p className={styles.panelLede}>Choose which channels we may use to contact you.</p>
            <div className={styles.form}>
              {COMM_FIELDS.map((field) => (
                <label key={field.key} className={styles.toggle} htmlFor={`comm-${field.key}`}>
                  <input
                    id={`comm-${field.key}`}
                    type="checkbox"
                    checked={comm[field.key]}
                    onChange={(event) => setComm((prev) => ({ ...prev, [field.key]: event.target.checked }))}
                  />
                  <span>
                    <span className={styles.toggleTitle}>{field.title}</span>
                    <br />
                    <span className={styles.toggleDesc}>{field.hint}</span>
                  </span>
                </label>
              ))}
              {commError && (
                <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
                  {commError}
                </p>
              )}
              {commNotice && (
                <p className={`${styles.notice} ${styles.noticeOk}`} role="status">
                  {commNotice}
                </p>
              )}
              <div className={styles.actions}>
                <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={commSaving} onClick={() => void handleCommSave()}>
                  <Save size={16} aria-hidden="true" />
                  {commSaving ? 'Saving…' : 'Save communication preferences'}
                </button>
              </div>
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="notif-h">
            <h2 id="notif-h">Notification preferences</h2>
            <p className={styles.panelLede}>Choose which return events trigger a notification.</p>
            <div className={styles.form}>
              {NOTIF_FIELDS.map((field) => (
                <label key={field.key} className={styles.toggle} htmlFor={`notif-${field.key}`}>
                  <input
                    id={`notif-${field.key}`}
                    type="checkbox"
                    checked={notif[field.key]}
                    onChange={(event) => setNotif((prev) => ({ ...prev, [field.key]: event.target.checked }))}
                  />
                  <span>
                    <span className={styles.toggleTitle}>{field.title}</span>
                    <br />
                    <span className={styles.toggleDesc}>{field.hint}</span>
                  </span>
                </label>
              ))}
              {notifError && (
                <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
                  {notifError}
                </p>
              )}
              {notifNotice && (
                <p className={`${styles.notice} ${styles.noticeOk}`} role="status">
                  {notifNotice}
                </p>
              )}
              <div className={styles.actions}>
                <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={notifSaving} onClick={() => void handleNotifSave()}>
                  <Save size={16} aria-hidden="true" />
                  {notifSaving ? 'Saving…' : 'Save notification preferences'}
                </button>
              </div>
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="password-h">
            <h2 id="password-h">Change password</h2>
            <p className={styles.panelLede}>Use at least 8 characters. You will stay signed in on this device.</p>
            <form className={styles.form} onSubmit={(event) => void handlePasswordSubmit(event)} noValidate>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="pw-current">
                  Current password
                </label>
                <input
                  id="pw-current"
                  className={styles.input}
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="pw-new">
                  New password
                </label>
                <input
                  id="pw-new"
                  className={styles.input}
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  aria-describedby="pw-new-error"
                  autoComplete="new-password"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="pw-confirm">
                  Confirm new password
                </label>
                <input
                  id="pw-confirm"
                  className={styles.input}
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  aria-describedby="pw-new-error"
                  autoComplete="new-password"
                />
                <FieldError
                  id="pw-new-error"
                  message={newPassword !== '' && confirmPassword !== '' && newPassword !== confirmPassword ? 'New passwords do not match.' : null}
                />
              </div>
              {passwordError && (
                <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
                  {passwordError}
                </p>
              )}
              {passwordNotice && (
                <p className={`${styles.notice} ${styles.noticeOk}`} role="status">
                  {passwordNotice}
                </p>
              )}
              <div className={styles.actions}>
                <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={passwordSaving}>
                  <Lock size={16} aria-hidden="true" />
                  {passwordSaving ? 'Changing…' : 'Change password'}
                </button>
              </div>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
