import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Package, UserPlus } from 'lucide-react'
import { useSession } from '../../lib/session'
import { ApiError, friendlyMessage } from '../../lib/api'
import styles from './auth.module.css'

export default function Signup() {
  const { signup } = useSession()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (fullName.trim().length < 2) {
      setError('Please enter your full name.')
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
      await signup(fullName.trim(), email.trim(), password)
      navigate('/customer', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_EXISTS') {
        setError('An account with this email already exists. Try signing in instead.')
      } else if (err instanceof ApiError && err.code === 'VALIDATION_ERROR' && err.errors?.length) {
        setError(err.errors.map((item) => item.message).join(' '))
      } else {
        setError(friendlyMessage(err))
      }
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
          <Link to="/" className={styles.backLink}>
            ← Back to home
          </Link>
        </div>
      </header>
      <main className={styles.main}>
        <div className={styles.card}>
          <p className={styles.kicker}>Create account</p>
          <h1>Track every return.</h1>
          <p className={styles.lede}>One account for orders, returns, pickup tracking, and refunds.</p>
          <form className={styles.form} onSubmit={onSubmit}>
            <div className={styles.field}>
              <label htmlFor="signup-name">Full name</label>
              <input
                id="signup-name"
                name="fullName"
                type="text"
                autoComplete="name"
                required
                minLength={2}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Rudra Chokshi"
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="signup-email">Email</label>
              <input
                id="signup-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="signup-password">Password</label>
              <input
                id="signup-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 6 characters"
                aria-describedby="signup-password-hint"
              />
              <p className={styles.hint} id="signup-password-hint">
                At least 6 characters. Use a password you do not reuse elsewhere.
              </p>
            </div>
            <div className={styles.field}>
              <label htmlFor="signup-confirm">Confirm password</label>
              <input
                id="signup-confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="Repeat your password"
              />
            </div>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <button type="submit" className={styles.submit} disabled={busy}>
              <UserPlus size={16} aria-hidden="true" />
              {busy ? 'Creating account…' : 'Create account'}
            </button>
          </form>
          <div className={styles.switch}>
            <span>
              Already have an account? <Link to="/login">Sign in</Link>
            </span>
          </div>
        </div>
      </main>
    </div>
  )
}
