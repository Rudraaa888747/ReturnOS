import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Package } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { errorMessage } from '../lib/api'
import { Button, Field, FormError, InlineSpinner, TextInput } from '../components/ui'
import styles from './Auth.module.css'

export default function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: string } }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!email.trim() || !password) {
      setError('Enter your email and password to sign in.')
      return
    }
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      navigate(location.state?.from ?? '/', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <p className={styles.brand}>
          <Package size={20} aria-hidden="true" /> ReturnOS
        </p>
        <h1>Sign in</h1>
        <p className={styles.sub}>Your returns, inspections and recovery work live here.</p>
        <form onSubmit={submit} noValidate>
          <Field label="Work email" htmlFor="login-email">
            <TextInput
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </Field>
          <Field label="Password" htmlFor="login-password">
            <TextInput
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </Field>
          <FormError message={error} />
          <div style={{ marginTop: 'var(--sp-4)' }}>
            <Button variant="primary" type="submit" disabled={busy} {...{ style: { width: '100%' } }}>
              {busy ? <InlineSpinner label="Signing in…" /> : 'Sign in'}
            </Button>
          </div>
        </form>
        <p className={styles.foot}>
          New customer? <Link to="/register">Create an account</Link>
        </p>
        <p className={styles.demo}>
          Demo logins — customer@returnos.dev · staff@returnos.dev · admin@returnos.dev
        </p>
      </div>
    </main>
  )
}
