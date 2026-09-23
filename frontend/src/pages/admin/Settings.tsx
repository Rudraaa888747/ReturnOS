import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ad } from '../../lib/admin'
import type { SettingState } from '../../lib/admin'
import { EmptyState, ErrorState, LoadingState, PageHead } from '../../components/ui'
import { ApiError, friendlyMessage } from '../../lib/api'
import ops from '../warehouse/ops.module.css'
import styles from './admin.module.css'

interface Reason {
  code: string;
  label: string;
  description: string | null;
  active: number;
  sort_order: number;
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export default function Settings() {
  const [settings, setSettings] = useState<SettingState[]>([])
  const [reasons, setReasons] = useState<Reason[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  const [reasonCode, setReasonCode] = useState('')
  const [reasonLabel, setReasonLabel] = useState('')
  const [reasonBusy, setReasonBusy] = useState(false)

  async function load(signal?: AbortSignal): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const [settingsData, reasonsData] = await Promise.all([
        ad<{ settings: SettingState[] }>('/settings', { signal }),
        ad<{ reasons: Reason[] }>('/return-reasons', { signal }),
      ])
      setSettings(settingsData.settings)
      setReasons(reasonsData.reasons)
      const next: Record<string, string> = {}
      for (const entry of settingsData.settings) {
        next[entry.key] = typeof entry.stored === 'object' ? JSON.stringify(entry.stored) : String(entry.stored ?? '');
      }
      setDrafts(next)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      if (err instanceof ApiError && err.status === 403) {
        setError('This account is not an admin.')
      } else {
        setError(friendlyMessage(err))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  async function saveSetting(event: FormEvent, key: string): Promise<void> {
    event.preventDefault()
    const raw = drafts[key] ?? ''
    let value: unknown = raw
    try {
      value = JSON.parse(raw)
    } catch {
      // Plain strings stay strings; numbers/objects parse as JSON.
      if (raw.trim() !== '' && !Number.isNaN(Number(raw))) {
        value = Number(raw)
      }
    }
    setSaving(key)
    setFormError(null)
    setSavedKey(null)
    try {
      await ad(`/settings/${key}`, { method: 'PATCH', body: { value } })
      setSavedKey(key)
      await load()
    } catch (err) {
      setFormError(friendlyMessage(err))
    } finally {
      setSaving(null)
    }
  }

  async function createReason(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (reasonCode.trim() === '' || reasonLabel.trim() === '') {
      setFormError('Reason code and label are required.')
      return
    }
    setReasonBusy(true)
    setFormError(null)
    try {
      await ad('/return-reasons', { method: 'POST', body: { code: reasonCode.trim(), label: reasonLabel.trim() } })
      setReasonCode('')
      setReasonLabel('')
      await load()
    } catch (err) {
      setFormError(friendlyMessage(err))
    } finally {
      setReasonBusy(false)
    }
  }

  async function toggleReason(reason: Reason): Promise<void> {
    setReasonBusy(true)
    setFormError(null)
    try {
      await ad(`/return-reasons/${reason.code}`, { method: 'PATCH', body: { active: reason.active !== 1 } })
      await load()
    } catch (err) {
      setFormError(friendlyMessage(err))
    } finally {
      setReasonBusy(false)
    }
  }

  if (loading) {
    return (
      <div>
        <PageHead kicker="Admin" title="Settings" lede="Policy parameters and return reasons." />
        <LoadingState label="Loading settings…" />
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <PageHead kicker="Admin" title="Settings" lede="Policy parameters and return reasons." />
        <ErrorState message={error} onRetry={() => setAttempt((v) => v + 1)} />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHead
        kicker="Admin"
        title="Settings"
        lede="Tunable policy parameters. Rule structure stays in code. Every change is validated and audited."
      />

      {formError && (
        <p className={styles.inlineError} role="alert">
          {formError}
        </p>
      )}

      <section className={ops.panel} aria-label="Policy parameters">
        <h2 className={ops.panelTitle}>Policy parameters</h2>
        {settings.length === 0 ? (
          <EmptyState title="No settings" body="No tunable parameters are registered." />
        ) : (
          <div className={ops.tableWrap}>
            <table className={ops.table}>
              <thead>
                <tr>
                  <th scope="col">Key</th>
                  <th scope="col">Value</th>
                  <th scope="col">Effective</th>
                  <th scope="col">Valid</th>
                  <th scope="col">Save</th>
                </tr>
              </thead>
              <tbody>
                {settings.map((entry) => (
                  <tr key={entry.key}>
                    <td>
                      <span className={ops.mono}>{entry.key}</span>
                      <div className={ops.muted}>{entry.description}</div>
                    </td>
                    <td>
                      <form
                        onSubmit={(event) => void saveSetting(event, entry.key)}
                        className={styles.inlineForm}
                      >
                        <input
                          className={styles.inlineInput}
                          value={drafts[entry.key] ?? ''}
                          onChange={(event) => setDrafts((prev) => ({ ...prev, [entry.key]: event.target.value }))}
                          aria-label={`Value for ${entry.key}`}
                        />
                        <button type="submit" className={styles.actionBtn} disabled={saving !== null}>
                          {saving === entry.key ? '…' : 'Save'}
                        </button>
                      </form>
                      {savedKey === entry.key && (
                        <span className={styles.inlineOk} role="status">
                          Saved.
                        </span>
                      )}
                    </td>
                    <td className={ops.mono}>{renderValue(entry.effective)}</td>
                    <td className={ops.mono}>{entry.valid ? 'yes' : 'INVALID — default in effect'}</td>
                    <td className={ops.muted}>default: {renderValue(entry.default)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={ops.panel} aria-label="Return reasons">
        <h2 className={ops.panelTitle}>Return reasons</h2>
        <form onSubmit={(event) => void createReason(event)}>
          <div className={ops.formGrid}>
            <label className={ops.field}>
              <span className={ops.label}>Code (A-Z, 0-9, _)</span>
              <input
                className={ops.input}
                value={reasonCode}
                onChange={(event) => setReasonCode(event.target.value.toUpperCase())}
                maxLength={40}
                placeholder="SIZE_SWAP"
              />
            </label>
            <label className={ops.field}>
              <span className={ops.label}>Label</span>
              <input
                className={ops.input}
                value={reasonLabel}
                onChange={(event) => setReasonLabel(event.target.value)}
                maxLength={200}
                placeholder="Size exchange wanted"
              />
            </label>
          </div>
          <div className={ops.btnRow}>
            <button type="submit" className={`${ops.btn} ${ops.btnPrimary}`} disabled={reasonBusy}>
              {reasonBusy ? 'Adding…' : 'Add reason'}
            </button>
          </div>
        </form>
        {reasons.length === 0 ? (
          <EmptyState title="No reasons" body="No return reasons configured." />
        ) : (
          <div className={ops.tableWrap}>
            <table className={ops.table}>
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Label</th>
                  <th scope="col">Status</th>
                  <th scope="col">Toggle</th>
                </tr>
              </thead>
              <tbody>
                {reasons.map((reason) => (
                  <tr key={reason.code}>
                    <td className={ops.mono}>{reason.code}</td>
                    <td>{reason.label}</td>
                    <td className={ops.mono}>{reason.active === 1 ? 'active' : 'disabled'}</td>
                    <td>
                      <button
                        type="button"
                        className={styles.actionBtn}
                        disabled={reasonBusy}
                        onClick={() => void toggleReason(reason)}
                      >
                        {reason.active === 1 ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
