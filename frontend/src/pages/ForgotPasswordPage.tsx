import { Link } from 'react-router-dom'
import { Package } from 'lucide-react'
import styles from './Auth.module.css'

/**
 * Placeholder: ReturnOS has no self-service password-reset endpoint.
 * Deliberately NOT a fake reset flow — directs to an administrator.
 */
export default function ForgotPasswordPage() {
  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <p className={styles.brand}>
          <Package size={20} aria-hidden="true" /> ReturnOS
        </p>
        <h1>Reset your password</h1>
        <p className={styles.sub}>
          Password resets are handled by your administrator. Ask them to set a new password for your account, then
          sign in again.
        </p>
        <p className={styles.foot}>
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </main>
  )
}
