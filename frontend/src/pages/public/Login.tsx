import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { LogIn, Package } from 'lucide-react'
import { useSession } from '../../lib/session'
import { ApiError, friendlyMessage } from '../../lib/api'
import styles from './auth.module.css'

export default function Login() {
  const { login, user } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('customer@returnos.test')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [signedIn, setSignedIn] = useState(false)

  const explicitFrom = (location.state as { from?: string } | null)?.from
  const from = explicitFrom ?? '/customer'

  // Operators land on their own panels when they use the generic login page,
  // unless they were heading somewhere explicit (e.g. a deep link).
  useEffect(() => {
    if (signedIn && user) {
      if (explicitFrom === undefined && user.role === 'WAREHOUSE') {
        navigate('/warehouse', { replace: true })
      } else if (explicitFrom === undefined && user.role === 'ADMIN') {
        navigate('/admin', { replace: true })
      } else {
        navigate(from, { replace: true })
      }
    }
  }, [signedIn, user, explicitFrom, from, navigate])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!email.trim() || !password) {
      setError('Email and password are both required.')
      return
    }
    setBusy(true)
    try {
      await login(email.trim(), password)
      setSignedIn(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Invalid email or password. Check your credentials and try again.')
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
          <p className={styles.kicker}>Customer sign in</p>
          <h1>Welcome back.</h1>
          <p className={styles.lede}>Sign in to open your customer panel — orders, returns, and tracking.</p>
          <form className={styles.form} onSubmit={onSubmit} noValidate={false}>
            <div className={styles.field}>
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                aria-invalid={error ? true : undefined}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your password"
                aria-invalid={error ? true : undefined}
              />
            </div>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <button type="submit" className={styles.submit} disabled={busy}>
              <LogIn size={16} aria-hidden="true" />
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <div className={styles.switch}>
            <Link to="/forgot-password">Forgot your password?</Link>
            <span>
              New to ReturnOS? <Link to="/signup">Create an account</Link>
            </span>
          </div>
          <div className={styles.demoBox} aria-label="Demo credentials">
            <div className={styles.demoTitle}>Public demo — pick a role</div>
            <div>
              Customer — <code>customer@returnos.test</code> / <code>Customer123</code>
            </div>
            <div>
              Warehouse — <code>warehouse@returnos.test</code> / <code>Warehouse123</code>
            </div>
            <div>
              Admin — <code>admin@returnos.test</code> / <code>Admin123</code>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
