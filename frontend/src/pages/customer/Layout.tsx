import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Bell,
  FileText,
  Home,
  LifeBuoy,
  LogOut,
  MapPin,
  Menu,
  PackageSearch,
  RotateCcw,
  Settings,
  ShoppingBag,
  Store,
  User,
  X,
} from 'lucide-react'
import { useSession } from '../../lib/session'
import { useCart } from '../../lib/cart'
import styles from './layout.module.css'
import { BrandMark } from '../../components/Logo'

const NAV: Array<{ section: string; links: Array<{ to: string; label: string; icon: React.ReactNode; end?: boolean }> }> = [
  {
    section: 'Manage',
    links: [
      { to: '/customer', label: 'Dashboard', icon: <Home size={17} aria-hidden="true" />, end: true },
      { to: '/customer/orders', label: 'My Orders', icon: <ShoppingBag size={17} aria-hidden="true" /> },
      { to: '/customer/store', label: 'Store', icon: <Store size={17} aria-hidden="true" /> },
      { to: '/customer/cart', label: 'Cart', icon: <ShoppingBag size={17} aria-hidden="true" /> },
      { to: '/customer/returns', label: 'My Returns', icon: <RotateCcw size={17} aria-hidden="true" /> },
      { to: '/customer/track', label: 'Track a Return', icon: <PackageSearch size={17} aria-hidden="true" /> },
    ],
  },
  {
    section: 'Support',
    links: [
      { to: '/customer/notifications', label: 'Notifications', icon: <Bell size={17} aria-hidden="true" /> },
      { to: '/customer/documents', label: 'Documents', icon: <FileText size={17} aria-hidden="true" /> },
      { to: '/customer/support', label: 'Help & Support', icon: <LifeBuoy size={17} aria-hidden="true" /> },
    ],
  },
  {
    section: 'Account',
    links: [
      { to: '/customer/addresses', label: 'Addresses', icon: <MapPin size={17} aria-hidden="true" /> },
      { to: '/customer/profile', label: 'Profile', icon: <User size={17} aria-hidden="true" /> },
      { to: '/customer/settings', label: 'Settings', icon: <Settings size={17} aria-hidden="true" /> },
    ],
  },
]

export default function CustomerLayout() {
  const { user, logout } = useSession()
  const { cart } = useCart()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  function handleLogout() {
    logout()
    navigate('/', { replace: true })
  }

  return (
    <div className={styles.shell}>
      <aside className={`${styles.side} ${open ? styles.sideOpen : ''}`} aria-label="Customer navigation">
        <a href="/" className={styles.brand} aria-label="ReturnOS home">
          <span className={styles.brandMark} aria-hidden="true">
            <BrandMark size={28} />
          </span>
          ReturnOS
        </a>
        <nav className={styles.nav}>
          {NAV.map((group) => (
            <div key={group.section}>
              <p className={styles.navSection}>{group.section}</p>
              {group.links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navActive : ''}`}
                >
                  {link.icon}
                  {link.label}
                  {link.to === '/customer/cart' && cart.totalQuantity > 0 && (
                    <span className={styles.navBadge} aria-label={`${cart.totalQuantity} items in cart`}>
                      {cart.totalQuantity}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className={styles.sideFoot}>
          <span className={styles.userEmail}>{user?.email}</span>
          <button type="button" className={styles.logout} onClick={handleLogout}>
            <LogOut size={15} aria-hidden="true" /> Logout
          </button>
        </div>
      </aside>

      {open && <button type="button" className={styles.scrim} aria-label="Close navigation" onClick={() => setOpen(false)} />}

      <div className={styles.main}>
        <div className={styles.topbar}>
          <button
            type="button"
            className={styles.menuBtn}
            aria-label={open ? 'Close navigation' : 'Open navigation'}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />}
          </button>
          <span className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              <BrandMark size={28} />
            </span>
            ReturnOS
          </span>
        </div>
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
