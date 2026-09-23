import { Navigate, useLocation } from 'react-router-dom'
import type { ReactElement } from 'react'
import { useSession } from '../lib/session'
import { LoadingState } from '../components/ui'

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

  return children
}
