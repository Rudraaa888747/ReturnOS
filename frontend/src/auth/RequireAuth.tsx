import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Role } from '../lib/types'
import { useAuth } from './AuthContext'

export function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, ready } = useAuth()
  const location = useLocation()

  if (!ready) {
    return (
      <main className="splash" aria-busy="true" aria-label="Loading ReturnOS">
        <span className="splash-mark" aria-hidden="true" />
        <p>Loading ReturnOS…</p>
      </main>
    )
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/403" replace />
  }
  return <>{children}</>
}
