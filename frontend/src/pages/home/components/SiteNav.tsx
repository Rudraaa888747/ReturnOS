import { useEffect, useRef, useState } from 'react'
import { Menu, Package, X } from 'lucide-react'
import styles from '../home.module.css'

const LINKS = [
  { href: '#platform', label: 'Platform' },
  { href: '#workflow', label: 'Lifecycle' },
  { href: '#operations', label: 'Operations' },
  { href: '#analytics', label: 'Analytics' },
  { href: '#recovery', label: 'Recovery' },
]

export function SiteNav() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    panel.current?.querySelector('a')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open ])

  return (
    <header className={`${styles.topnav} ${scrolled ? styles.topnavScrolled : ''}`}>
      <div className={styles.topnavInner}>
        <a href="/" className={styles.wordmark} aria-label="ReturnOS home">
          <span className={styles.wordmarkMark} aria-hidden="true">
            <Package size={15} strokeWidth={2.2} />
          </span>
          ReturnOS
          <span className={styles.wordmarkSub}>reverse logistics</span>
        </a>
        <nav className={styles.navLinks} aria-label="Product sections">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className={styles.navCtas}>
          <a href="#track" className={styles.trackLink}>
            Track a return
          </a>
          <a href="/login" className={styles.signIn}>
            Sign in
          </a>
          <a href="/signup" className={styles.ctaSmall}>
            Get started
          </a>
          <button
            ref={trigger}
            type="button"
            className={styles.menuBtn}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />}
          </button>
        </div>
      </div>
      {open && (
        <div ref={panel} id="site-menu" className={styles.mobileMenu}>
          <nav aria-label="Mobile sections" onClick={() => setOpen(false)}>
            {LINKS.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
            <a href="#track">Track a return</a>
          </nav>
          <div className={styles.mobileCtas}>
            <a href="/signup" onClick={() => setOpen(false)} className={styles.ctaPrimary}>
              Get started
            </a>
          </div>
        </div>
      )}
    </header>
  )
}
