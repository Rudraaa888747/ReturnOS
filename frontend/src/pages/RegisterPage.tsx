import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Package } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { ApiRequestError, errorMessage } from '../lib/api'
import { Button, Field, FormError, InlineSpinner, TextInput } from '../components/ui'
import styles from './Auth.module.css'

export default function RegisterPage() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (fullName.trim().length < 2) next.fullName = 'Tell us your name (at least 2 characters).'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) next.email = 'That email address does not look right.'
    if (password.length < 8) next.password = 'Use at least 8 characters.'
    setErrors(next)
    setFormError(null)
    if (Object.keys(next).length > 0) return
    setBusy(true)
    try {
      await signUp(email.trim(), password, fullName.trim())
      navigate('/', { replace: true })
    } catch (err) {
      if (err instanceof ApiRequestError && err.fields) setErrors(err.fields)
      else setFormError(errorMessage(err))
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
        <h1>Create your account</h1>
        <p className={styles.sub}>Track orders, raise returns and follow every step to resolution.</p>
        <form onSubmit={submit} noValidate>
          <Field label="Full name" htmlFor="reg-name" error={errors.fullName}>
            <TextInput
              id="reg-name"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={busy}
              invalid={Boolean(errors.fullName)}
            />
          </Field>
          <Field label="Email" htmlFor="reg-email" error={errors.email}>
            <TextInput
              id="reg-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              invalid={Boolean(errors.email)}
            />
          </Field>
          <Field label="Password" htmlFor="reg-password" hint="At least 8 characters." error={errors.password}>
            <TextInput
              id="reg-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              invalid={Boolean(errors.password)}
            />
          </Field>
          <FormError message={formError} />
          <div style={{ marginTop: 'var(--sp-4)' }}>
            <Button variant="primary" type="submit" disabled={busy} {...{ style: { width: '100%' } }}>
              {busy ? <InlineSpinner label="Creating account…" /> : 'Create account'}
            </Button>
          </div>
        </form>
        <p className={styles.foot}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </main>
  )
}
