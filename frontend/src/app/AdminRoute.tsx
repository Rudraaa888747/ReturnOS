import { Navigate, useLocation } from 'react-router-dom'
import type { ReactElement } from 'react'
import { useSession } from '../lib/session'
import { LoadingState } from '../components/ui'
import { homePathFor } from './roleHome'

/**
 * Admin-only route guard. Anyone without the ADMIN role lands in their own
 * panel (customers) or the login page — same shape as WarehouseRoute.
 */
export default function AdminRoute({ children }: { children: ReactElement }) {
  const { user, ready } = useSession()
  const location = useLocation()

  if (!ready) {
    return (
      <main style={{ padding: '3rem 1.25rem', maxWidth: 720, margin: '0 auto' }}>
        <LoadingState label="Checking your session…" />
      </main>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  if (user.role !== 'ADMIN') {
    return <Navigate to={homePathFor(user.role)} replace />
  }

  return children
}
