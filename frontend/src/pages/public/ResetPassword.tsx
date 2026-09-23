import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { KeyRound, Package } from 'lucide-react'
import { api, friendlyMessage } from '../../lib/api'
import styles from './auth.module.css'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [token, setToken] = useState(params.get('token') ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!token.trim()) {
      setError('A reset token is required. Open the link from your reset email.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setBusy(true)
    try {
      await api<{ message: string }>('/auth/reset', {
        method: 'POST',
        body: { token: token.trim(), newPassword: password },
      })
      navigate('/login', { replace: true, state: { reset: true } })
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <Link to="/" className={styles.wordmark} aria-label="ReturnOS home">
            <span className={styles.wordmarkMark} aria-hidden="true">
              <Package size={15} strokeWidth={2.2} />
            </span>
            ReturnOS
          </Link>
          <Link to="/login" className={styles.backLink}>
            ← Back to sign in
          </Link>
        </div>
      </header>
      <main className={styles.main}>
        <div className={styles.card}>
          <p className={styles.kicker}>Set a new password</p>
          <h1>Choose a new password.</h1>
          <p className={styles.lede}>Paste your reset token and pick a new password.</p>
          <form className={styles.form} onSubmit={onSubmit}>
            <div className={styles.field}>
              <label htmlFor="reset-token">Reset token</label>
              <input
                id="reset-token"
                name="token"
                type="text"
                autoComplete="off"
                required
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Token from your reset email"
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="reset-password">New password</label>
              <input
                id="reset-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 6 characters"
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="reset-confirm">Confirm new password</label>
              <input
                id="reset-confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="Repeat your new password"
              />
            </div>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <button type="submit" className={styles.submit} disabled={busy}>
              <KeyRound size={16} aria-hidden="true" />
              {busy ? 'Resetting…' : 'Reset password'}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
