import { Suspense, lazy } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { PageSkeleton } from '../../components/ui'

const HomePage = lazy(() => import('./HomePage'))

/**
 * Root route: the public homepage for visitors. Signed-in users go to
 * /home, which renders their role workspace INSIDE the application Shell.
 */
export default function HomeRoute() {
  const { user, ready } = useAuth()
  if (!ready) return <PageSkeleton />
  if (user) return <Navigate to="/home" replace />
  return (
    <Suspense fallback={<PageSkeleton />}>
      <HomePage />
    </Suspense>
  )
}
