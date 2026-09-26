import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LayoutDashboard, PackageSearch, LogOut, Boxes, Truck, ClipboardList, TrendingUp } from 'lucide-react'
import { useSession } from '../../lib/session'
import { wh } from '../../lib/warehouse'
import type { WarehouseContext } from '../../lib/warehouse'
import styles from './layout.module.css'
import { BrandMark } from '../../components/Logo'

/**
 * Operational shell for the warehouse floor. Deliberately denser than the
 * customer panel: compact nav, mono identifiers, no marketing surfaces.
 * New Phase 6 sections plug in as additional NavLinks here.
 */
export default function WarehouseLayout() {
  const { logout } = useSession()
  const navigate = useNavigate()
  const [context, setContext] = useState<WarehouseContext | null>(null)

  useEffect(() => {
    let cancelled = false
    wh<WarehouseContext>('/me')
      .then((data) => {
        if (!cancelled) setContext(data)
      })
      .catch(() => {
        if (!cancelled) setContext(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function handleLogout(): void {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.side} aria-label="Warehouse navigation">
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            <BrandMark size={32} />
          </span>
          <span className={styles.brandText}>
            <span className={styles.brandName}>ReturnOS Floor</span>
            <span className={styles.brandSub}>{context ? `${context.warehouse.code} · ${context.warehouse.city}` : '…'}</span>
          </span>
        </div>
        <nav className={styles.nav}>
          <NavLink
            to="/warehouse"
            end
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navActive : ''}`}
          >
            <LayoutDashboard size={16} aria-hidden="true" /> Dashboard
          </NavLink>
          <NavLink
            to="/warehouse/returns"
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navActive : ''}`}
          >
            <PackageSearch size={16} aria-hidden="true" /> Returns
          </NavLink>
          <NavLink
            to="/warehouse/inventory"
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navActive : ''}`}
          >
            <Boxes size={16} aria-hidden="true" /> Inventory
          </NavLink>
          <NavLink
            to="/warehouse/shipments"
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navActive : ''}`}
          >
            <Truck size={16} aria-hidden="true" /> Shipments
          </NavLink>
          <NavLink
            to="/warehouse/tasks"
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navActive : ''}`}
          >
            <ClipboardList size={16} aria-hidden="true" /> Tasks
          </NavLink>
          <NavLink
            to="/warehouse/analytics"
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navActive : ''}`}
          >
            <TrendingUp size={16} aria-hidden="true" /> Analytics
          </NavLink>
        </nav>
        <div className={styles.sideFoot}>
          <span className={styles.operator}>{context ? context.operator.role : 'OPERATOR'}</span>
          <button type="button" className={styles.logout} onClick={handleLogout}>
            <LogOut size={14} aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>
      <div className={styles.main}>
        <header className={styles.topbar}>
          <span className={styles.topbarTitle}>{context ? context.warehouse.name : 'Warehouse operations'}</span>
          <Link className={styles.topbarLink} to="/warehouse/returns">
            Work the queue
          </Link>
        </header>
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
