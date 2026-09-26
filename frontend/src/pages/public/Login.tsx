import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { useSession } from '../../lib/session'
import { ApiError, friendlyMessage } from '../../lib/api'
import { homePathFor, pathMatchesRole } from '../../app/roleHome'
import styles from './auth.module.css'
import { BrandMark } from '../../components/Logo'

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

  // Everyone lands in the panel their role can actually use. A deep link
  // recorded before sign-in is honoured only when it belongs to that panel:
  // an operator who was bounced off /customer/orders would otherwise be sent
  // straight back to a page the customer API rejects.
  useEffect(() => {
    if (signedIn && user) {
      const target =
        explicitFrom !== undefined && pathMatchesRole(explicitFrom, user.role)
          ? explicitFrom
          : homePathFor(user.role)
      navigate(target, { replace: true })
    }
  }, [signedIn, user, explicitFrom, navigate])

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
              <BrandMark size={28} />
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
