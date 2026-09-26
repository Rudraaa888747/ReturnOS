import { Navigate, useLocation } from 'react-router-dom'
import type { ReactElement } from 'react'
import { useSession } from '../lib/session'
import { LoadingState } from '../components/ui'
import { homePathFor } from './roleHome'

/**
 * Customer-only route guard. Anonymous visitors go to login (which returns
 * them here after sign-in); operators and admins go to their own panels —
 * same shape as WarehouseRoute and AdminRoute.
 *
 * The role check matters as much as the login check: the customer API rejects
 * a warehouse or admin token, so rendering these pages for them produced a
 * fully drawn layout followed by an error card.
 */
export default function ProtectedRoute({ children }: { children: ReactElement }) {
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

  if (user.role !== 'CUSTOMER') {
    return <Navigate to={homePathFor(user.role)} replace />
  }

  return children
}
