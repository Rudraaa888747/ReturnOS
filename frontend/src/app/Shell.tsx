import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LogOut, Package } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import styles from './Shell.module.css'

interface NavItem {
  to: string
  label: string
  end?: boolean
}

function navFor(role: string | undefined): NavItem[] {
  if (role === 'ADMIN')
    return [
      { to: '/admin', label: 'Control center', end: true },
      { to: '/admin/tasks', label: 'Tasks' },
      { to: '/admin/audit', label: 'Audit' },
      { to: '/ops/returns', label: 'Returns' },
    ]
  if (role === 'WAREHOUSE_STAFF')
    return [
      { to: '/ops', label: 'Operations', end: true },
      { to: '/ops/returns', label: 'Work queue' },
      { to: '/ops/tasks', label: 'My tasks' },
    ]
  return [
    { to: '/', label: 'Home', end: true },
    { to: '/returns', label: 'My returns' },
    { to: '/returns/new', label: 'New return' },
  ]
}

function roleLabel(role: string | undefined): string {
  if (role === 'ADMIN') return 'Admin'
  if (role === 'WAREHOUSE_STAFF') return 'Warehouse'
  return 'Customer'
}

export function Shell() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const onSignOut = () => {
    signOut()
    navigate('/login', { replace: true })
  }

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
        <nav className={styles.nav}>
          {navFor(user?.role).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
            >
              {item.label}
            </NavLink>
          ))}
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
            {navFor(user?.role).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
              >
                {item.label}
              </NavLink>
            ))}
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
