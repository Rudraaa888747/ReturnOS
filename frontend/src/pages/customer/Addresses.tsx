import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { MapPin, Pencil, Plus, Trash } from 'lucide-react';
import { api, friendlyMessage } from '../../lib/api';
import type { AddressRow } from '../../lib/api';
import { EmptyState, ErrorState, FieldError, LoadingState, PageHead } from '../../components/ui';
import styles from './addresses.module.css';

interface AddressForm {
  label: string;
  fullName: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  isDefault: boolean;
}

const EMPTY_FORM: AddressForm = {
  label: '',
  fullName: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'India',
  phone: '',
  isDefault: false,
};

function toForm(row: AddressRow): AddressForm {
  return {
    label: row.label ?? '',
    fullName: row.full_name,
    line1: row.line1,
    line2: row.line2 ?? '',
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    country: row.country,
    phone: row.phone ?? '',
    isDefault: row.is_default === 1,
  };
}

export default function Addresses() {
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AddressForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ addresses: AddressRow[] }>('/addresses');
      setAddresses(data.addresses);
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
    setNotice(null);
    setFormOpen(true);
  }

  function openEdit(row: AddressRow) {
    setEditingId(row.id);
    setForm(toForm(row));
    setFieldErrors({});
    setFormError(null);
    setNotice(null);
    setFormOpen(true);
  }

  function setField<Key extends keyof AddressForm>(key: Key, value: AddressForm[Key]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function validate(): Record<string, string> {
    const problems: Record<string, string> = {};
    if (form.fullName.trim() === '') problems.fullName = 'Enter the full name for this address.';
    if (form.line1.trim() === '') problems.line1 = 'Enter the street address.';
    if (form.city.trim() === '') problems.city = 'Enter the city.';
    if (form.state.trim() === '') problems.state = 'Enter the state.';
    if (form.postalCode.trim() === '') problems.postalCode = 'Enter the postal code.';
    if (form.phone.trim() !== '' && !/^[+\d][\d\s-]{5,18}$/.test(form.phone.trim())) {
      problems.phone = 'Enter a valid phone number.';
    }
    return problems;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const problems = validate();
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setSaving(true);
    setFormError(null);
    try {
      const body = {
        label: form.label.trim() === '' ? undefined : form.label.trim(),
        fullName: form.fullName.trim(),
        line1: form.line1.trim(),
        line2: form.line2.trim() === '' ? undefined : form.line2.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        postalCode: form.postalCode.trim(),
        country: form.country.trim() === '' ? undefined : form.country.trim(),
        phone: form.phone.trim() === '' ? undefined : form.phone.trim(),
        isDefault: form.isDefault,
      };
      if (editingId) {
        const data = await api<{ address: AddressRow }>(`/addresses/${editingId}`, { method: 'PATCH', body });
        setAddresses((prev) =>
          prev.map((row) => (row.id === editingId ? data.address : form.isDefault ? { ...row, is_default: 0 } : row)),
        );
        setNotice('Address updated.');
      } else {
        const data = await api<{ address: AddressRow }>('/addresses', { method: 'POST', body });
        setAddresses((prev) => (form.isDefault ? [...prev.map((row) => ({ ...row, is_default: 0 })), data.address] : [...prev, data.address]));
        setNotice('Address added.');
      }
      setFormOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(friendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: AddressRow) {
    const confirmed = window.confirm(`Delete the address "${row.label ?? row.line1}"? This cannot be undone.`);
    if (!confirmed) return;
    setNotice(null);
    setFormError(null);
    try {
      await api<{ message: string }>(`/addresses/${row.id}`, { method: 'DELETE' });
      setAddresses((prev) => prev.filter((entry) => entry.id !== row.id));
      setNotice('Address deleted.');
    } catch (err) {
      setFormError(friendlyMessage(err));
    }
  }

  async function handleSetDefault(row: AddressRow) {
    setNotice(null);
    setFormError(null);
    try {
      const data = await api<{ address: AddressRow }>(`/addresses/${row.id}`, {
        method: 'PATCH',
        body: { isDefault: true },
      });
      setAddresses((prev) => prev.map((entry) => (entry.id === row.id ? data.address : { ...entry, is_default: 0 })));
      setNotice('Default address updated.');
    } catch (err) {
      setFormError(friendlyMessage(err));
    }
  }

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Account"
        title="Addresses"
        lede="Manage pickup and contact addresses used for your returns."
        actions={
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={openAdd}>
            <Plus size={16} aria-hidden="true" /> Add address
          </button>
        }
      />

      {notice && (
        <p className={`${styles.notice} ${styles.noticeOk}`} role="status">
          {notice}
        </p>
      )}
      {formError && !formOpen && (
        <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
          {formError}
        </p>
      )}

      {loading ? (
        <LoadingState label="Loading addresses…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : addresses.length === 0 && !formOpen ? (
        <EmptyState
          title="No addresses yet"
          body="Add your first address so pickups can be arranged without delay."
          action={
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={openAdd}>
              <Plus size={16} aria-hidden="true" /> Add address
            </button>
          }
        />
      ) : (
        <ul className={styles.list}>
          {addresses.map((row) => (
            <li key={row.id} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.cardLabel}>
                  <MapPin size={15} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />
                  {row.label ?? 'Address'}
                </span>
                {row.is_default === 1 && <span className={styles.badge}>Default</span>}
              </div>
              <p className={styles.cardAddress}>
                {row.full_name}
                <br />
                {row.line1}
                {row.line2 && (
                  <>
                    <br />
                    {row.line2}
                  </>
                )}
                <br />
                {row.city}, {row.state} {row.postal_code}
                <br />
                {row.country}
              </p>
              {row.phone && <p className={styles.cardMeta}>Phone: {row.phone}</p>}
              <div className={styles.cardActions}>
                <button type="button" className={styles.btn} onClick={() => openEdit(row)}>
                  <Pencil size={15} aria-hidden="true" /> Edit
                </button>
                {row.is_default !== 1 && (
                  <button type="button" className={styles.btn} onClick={() => void handleSetDefault(row)}>
                    Set as default
                  </button>
                )}
                <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => void handleDelete(row)}>
                  <Trash size={15} aria-hidden="true" /> Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {formOpen && (
        <section className={styles.panel} aria-labelledby="address-form-h">
          <h2 id="address-form-h">{editingId ? 'Edit address' : 'Add address'}</h2>
          <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
            <div className={styles.grid2}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="addr-label">
                  Label (optional)
                </label>
                <input
                  id="addr-label"
                  className={styles.input}
                  type="text"
                  value={form.label}
                  onChange={(event) => setField('label', event.target.value)}
                  placeholder="Home, Office"
                  maxLength={60}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="addr-name">
                  Full name
                </label>
                <input
                  id="addr-name"
                  className={styles.input}
                  type="text"
                  value={form.fullName}
                  onChange={(event) => setField('fullName', event.target.value)}
                  aria-describedby="addr-name-error"
                  maxLength={120}
                  autoComplete="name"
                />
                <FieldError id="addr-name-error" message={fieldErrors.fullName ?? null} />
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="addr-line1">
                Street address
              </label>
              <input
                id="addr-line1"
                className={styles.input}
                type="text"
                value={form.line1}
                onChange={(event) => setField('line1', event.target.value)}
                aria-describedby="addr-line1-error"
                maxLength={200}
                autoComplete="street-address"
              />
              <FieldError id="addr-line1-error" message={fieldErrors.line1 ?? null} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="addr-line2">
                Apartment, suite, landmark (optional)
              </label>
              <input
                id="addr-line2"
                className={styles.input}
                type="text"
                value={form.line2}
                onChange={(event) => setField('line2', event.target.value)}
                maxLength={200}
              />
            </div>
            <div className={styles.grid2}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="addr-city">
                  City
                </label>
                <input
                  id="addr-city"
                  className={styles.input}
                  type="text"
                  value={form.city}
                  onChange={(event) => setField('city', event.target.value)}
                  aria-describedby="addr-city-error"
                  maxLength={100}
                  autoComplete="address-level2"
                />
                <FieldError id="addr-city-error" message={fieldErrors.city ?? null} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="addr-state">
                  State
                </label>
                <input
                  id="addr-state"
                  className={styles.input}
                  type="text"
                  value={form.state}
                  onChange={(event) => setField('state', event.target.value)}
                  aria-describedby="addr-state-error"
                  maxLength={100}
                  autoComplete="address-level1"
                />
                <FieldError id="addr-state-error" message={fieldErrors.state ?? null} />
              </div>
            </div>
            <div className={styles.grid2}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="addr-postal">
                  Postal code
                </label>
                <input
                  id="addr-postal"
                  className={styles.input}
                  type="text"
                  value={form.postalCode}
                  onChange={(event) => setField('postalCode', event.target.value)}
                  aria-describedby="addr-postal-error"
                  maxLength={20}
                  autoComplete="postal-code"
                />
                <FieldError id="addr-postal-error" message={fieldErrors.postalCode ?? null} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="addr-country">
                  Country
                </label>
                <input
                  id="addr-country"
                  className={styles.input}
                  type="text"
                  value={form.country}
                  onChange={(event) => setField('country', event.target.value)}
                  maxLength={100}
                  autoComplete="country-name"
                />
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="addr-phone">
                Phone (optional)
              </label>
              <input
                id="addr-phone"
                className={styles.input}
                type="tel"
                value={form.phone}
                onChange={(event) => setField('phone', event.target.value)}
                aria-describedby="addr-phone-error"
                maxLength={24}
                autoComplete="tel"
              />
              <FieldError id="addr-phone-error" message={fieldErrors.phone ?? null} />
            </div>
            <label className={styles.checkRow} htmlFor="addr-default">
              <input
                id="addr-default"
                type="checkbox"
                checked={form.isDefault}
                onChange={(event) => setField('isDefault', event.target.checked)}
              />
              Use as default address
            </label>
            {formError && (
              <p className={`${styles.notice} ${styles.noticeError}`} role="alert">
                {formError}
              </p>
            )}
            <div className={styles.actions}>
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add address'}
              </button>
              <button
                type="button"
                className={styles.btn}
                disabled={saving}
                onClick={() => {
                  setFormOpen(false);
                  setEditingId(null);
                  setForm(EMPTY_FORM);
                  setFieldErrors({});
                  setFormError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
