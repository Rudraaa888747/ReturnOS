import { Link } from 'react-router-dom'
import { Package } from 'lucide-react'
import { Hero } from './Hero'
import { Lifecycle, Workspaces } from './Sections'
import { FinalCta, Footer, Principles, Showcase } from './Showcase'
import styles from './home.module.css'

function TopNav() {
  return (
    <header className={styles.topnav}>
      <div className={styles.topnavInner}>
        <Link to="/" className={styles.wordmark} aria-label="ReturnOS home">
          <span className={styles.wordmarkMark} aria-hidden="true">
            <Package size={15} strokeWidth={2.2} />
          </span>
          ReturnOS
        </Link>
        <nav className={styles.navLinks} aria-label="Sections">
          <a href="#product">Product</a>
          <a href="#workflow">Workflow</a>
          <a href="#workspaces">Workspaces</a>
        </nav>
        <div className={styles.navCtas}>
          <Link to="/login" className={styles.signIn}>
            Sign in
          </Link>
          <Link to="/login" className={styles.ctaSmall}>
            Explore ReturnOS
          </Link>
        </div>
      </div>
    </header>
  )
}

export default function HomePage() {
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <TopNav />
      <main id="main" tabIndex={-1}>
        <Hero />
        <Workspaces />
        <Lifecycle />
        <Showcase />
        <Principles />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}
