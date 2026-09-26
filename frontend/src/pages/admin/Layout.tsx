import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  ShoppingCart,
  PackageSearch,
  Warehouse,
  LifeBuoy,
  Bell,
  BarChart3,
  ShieldCheck,
  ScrollText,
  Settings,
  FileDown,
  LogOut,
} from 'lucide-react'
import { useSession } from '../../lib/session'
import styles from './layout.module.css'
import { BrandMark } from '../../components/Logo'

/**
 * Admin console shell. Same operational density as the warehouse floor
 * (shared table/panel primitives), distinct brand mark and full §6 nav tree.
 */

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ to: '/admin', label: 'Dashboard', icon: <LayoutDashboard size={16} aria-hidden="true" />, end: true }],
  },
  {
    label: 'Commerce',
    items: [
      { to: '/admin/orders', label: 'Orders', icon: <ShoppingCart size={16} aria-hidden="true" /> },
      { to: '/admin/products', label: 'Products', icon: <PackageSearch size={16} aria-hidden="true" /> },
      { to: '/admin/categories', label: 'Categories', icon: <PackageSearch size={16} aria-hidden="true" /> },
      { to: '/admin/inventory', label: 'Inventory', icon: <Warehouse size={16} aria-hidden="true" /> },
    ],
  },
  {
    label: 'Returns',
    items: [
      { to: '/admin/returns', label: 'All Returns', icon: <PackageSearch size={16} aria-hidden="true" /> },
      { to: '/admin/refunds', label: 'Refunds', icon: <FileDown size={16} aria-hidden="true" /> },
      { to: '/admin/credit', label: 'Store Credit', icon: <ShieldCheck size={16} aria-hidden="true" /> },
    ],
  },
  {
    label: 'Customers',
    items: [{ to: '/admin/customers', label: 'Customers', icon: <Users size={16} aria-hidden="true" /> }],
  },
  {
    label: 'Warehouse',
    items: [
      { to: '/admin/warehouses', label: 'Warehouses', icon: <Warehouse size={16} aria-hidden="true" /> },
      { to: '/admin/workload', label: 'Workload', icon: <BarChart3 size={16} aria-hidden="true" /> },
    ],
  },
  {
    label: 'Support',
    items: [
      { to: '/admin/support', label: 'Tickets', icon: <LifeBuoy size={16} aria-hidden="true" /> },
      { to: '/admin/notifications', label: 'Notifications', icon: <Bell size={16} aria-hidden="true" /> },
      { to: '/admin/reports', label: 'Reports', icon: <FileDown size={16} aria-hidden="true" /> },
      { to: '/admin/analytics', label: 'Analytics', icon: <BarChart3 size={16} aria-hidden="true" /> },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/admin/accounts', label: 'Users & Roles', icon: <ShieldCheck size={16} aria-hidden="true" /> },
      { to: '/admin/audit', label: 'Audit Logs', icon: <ScrollText size={16} aria-hidden="true" /> },
      { to: '/admin/settings', label: 'Settings', icon: <Settings size={16} aria-hidden="true" /> },
    ],
  },
]

export default function AdminLayout() {
  const { logout } = useSession()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  function handleLogout(): void {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.side} aria-label="Admin navigation">
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            <BrandMark size={32} />
          </span>
          <span className={styles.brandText}>
            <span className={styles.brandName}>Admin Console</span>
            <span className={styles.brandSub}>ReturnOS ops</span>
          </span>
          <button
            type="button"
            className={styles.menuBtn}
            aria-expanded={open}
            aria-label={open ? 'Close navigation' : 'Open navigation'}
            onClick={() => setOpen((value) => !value)}
          >
            ☰
          </button>
        </div>
        <nav className={`${styles.nav} ${open ? styles.navOpen : ''}`}>
          {NAV.map((group) => (
            <div key={group.label} className={styles.navGroup}>
              <span className={styles.navLabel}>{group.label}</span>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navActive : ''}`}
                >
                  {item.icon} {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className={styles.sideFoot}>
          <span className={styles.operator}>ADMIN</span>
          <button type="button" className={styles.logout} onClick={handleLogout}>
            <LogOut size={14} aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>
      <div className={styles.main}>
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
