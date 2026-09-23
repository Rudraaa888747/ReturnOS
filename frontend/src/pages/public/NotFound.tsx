import { Link, useLocation } from 'react-router-dom'
import { Package } from 'lucide-react'
import styles from '../public/auth.module.css'

export default function NotFound() {
  const location = useLocation()
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
          <p className={styles.kicker}>404</p>
          <h1>Page not found.</h1>
          <p className={styles.lede}>
            No page exists at <code>{location.pathname}</code>. Check the address or head back home.
          </p>
          <div className={styles.switch}>
            <Link to="/">Go to the homepage</Link>
            <Link to="/customer">Open the customer panel</Link>
          </div>
        </div>
      </main>
    </div>
  )
}
