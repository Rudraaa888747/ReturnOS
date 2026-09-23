import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { MailQuestion, Package } from 'lucide-react'
import { api, friendlyMessage } from '../../lib/api'
import styles from './auth.module.css'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!email.trim()) {
      setError('Enter the email address you signed up with.')
      return
    }
    setBusy(true)
    try {
      await api<{ message: string }>('/auth/forgot', {
        method: 'POST',
        body: { email: email.trim() },
      })
      setDone(true)
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
          <p className={styles.kicker}>Password recovery</p>
          <h1>Forgot your password?</h1>
          <p className={styles.lede}>Enter your account email and we will create a reset link for you.</p>
          {done ? (
            <p className={styles.success} role="status">
              If an account exists for that email, a password reset link was created. Check your inbox for next
              steps.
            </p>
          ) : (
            <form className={styles.form} onSubmit={onSubmit}>
              <div className={styles.field}>
                <label htmlFor="forgot-email">Email</label>
                <input
                  id="forgot-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className={styles.submit} disabled={busy}>
                <MailQuestion size={16} aria-hidden="true" />
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}
          <div className={styles.switch}>
            <span>
              Remembered it? <Link to="/login">Sign in</Link>
            </span>
          </div>
        </div>
      </main>
    </div>
  )
}
