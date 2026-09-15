import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LogOut, Package } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import styles from './Shell.module.css'

interface NavItem {
  to: string
  label: string
  /** Exact path, or section: the path plus one id segment (never a sibling like /new). */
  match: 'exact' | 'section'
}

function navFor(role: string | undefined): NavItem[] {
  if (role === 'ADMIN')
    return [
      { to: '/admin', label: 'Control center', match: 'exact' },
      { to: '/admin/tasks', label: 'Tasks', match: 'exact' },
      { to: '/admin/audit', label: 'Audit', match: 'exact' },
      { to: '/ops/returns', label: 'Returns', match: 'section' },
      { to: '/ops/orders', label: 'Orders', match: 'exact' },
    ]
  if (role === 'WAREHOUSE_STAFF')
    return [
      { to: '/ops', label: 'Operations', match: 'exact' },
      { to: '/ops/returns', label: 'Work queue', match: 'section' },
      { to: '/ops/orders', label: 'Orders', match: 'exact' },
      { to: '/ops/tasks', label: 'My tasks', match: 'exact' },
    ]
  return [
    { to: '/home', label: 'Home', match: 'exact' },
    { to: '/returns', label: 'My returns', match: 'section' },
    { to: '/returns/new', label: 'New return', match: 'exact' },
    { to: '/orders/new', label: 'Place an order', match: 'exact' },
  ]
}

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.match === 'exact') return pathname === item.to
  if (pathname === item.to) return true
  // Section: exactly one more segment, and never the sibling form route (/new).
  const rest = pathname.slice(item.to.length)
  if (!rest.startsWith('/')) return false
  const segment = rest.slice(1)
  return segment.length > 0 && !segment.includes('/') && segment !== 'new'
}

function roleLabel(role: string | undefined): string {
  if (role === 'ADMIN') return 'Admin'
  if (role === 'WAREHOUSE_STAFF') return 'Warehouse'
  return 'Customer'
}

export function Shell() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const items = navFor(user?.role)

  const onSignOut = () => {
    signOut()
    navigate('/login', { replace: true })
  }

  const links = items.map((item) => {
    const active = isNavActive(item, pathname)
    return (
      <Link
        key={item.to}
        to={item.to}
        aria-current={active ? 'page' : undefined}
        className={active ? `${styles.link} ${styles.active}` : styles.link}
      >
        {item.label}
      </Link>
    )
  })

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <aside className={styles.side} aria-label="Primary">
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            <Package size={18} strokeWidth={2.2} />
          </span>
          <span className={styles.brandText}>
            ReturnOS
            <small>Reverse logistics</small>
          </span>
        </div>
        <nav className={styles.nav} aria-label="Primary">
          {links}
        </nav>
        <div className={styles.sideFoot}>
          <div className={styles.who}>
            <strong>{user?.fullName}</strong>
            <span>
              {roleLabel(user?.role)} · {user?.email}
            </span>
          </div>
          <button type="button" className={styles.signOut} onClick={onSignOut}>
            <LogOut size={15} aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>
      <div className={styles.main}>
        <header className={styles.topbar}>
          <span className={styles.topbarBrand} aria-hidden="true">
            <Package size={16} /> ReturnOS
          </span>
          <nav className={styles.topnav} aria-label="Primary">
            {links}
          </nav>
          <button type="button" className={styles.signOut} onClick={onSignOut}>
            <LogOut size={15} aria-hidden="true" /> Sign out
          </button>
        </header>
        <main id="main" className={`${styles.content} view-enter`} tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
