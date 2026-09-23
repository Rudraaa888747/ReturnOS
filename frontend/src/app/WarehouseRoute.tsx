import { Navigate, useLocation } from 'react-router-dom'
import type { ReactElement } from 'react'
import { useSession } from '../lib/session'
import { LoadingState } from '../components/ui'

/**
 * Warehouse-only route guard. Customers are sent to their own panel and
 * anonymous visitors to login (which returns them here after sign-in).
 * Role is read from the live session, so revoking an operator applies
 * the moment the session refreshes.
 */
export default function WarehouseRoute({ children }: { children: ReactElement }) {
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

  if (user.role !== 'WAREHOUSE') {
    return <Navigate to="/customer" replace />
  }

  return children
}
