import { Suspense, lazy } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { PageSkeleton } from '../../components/ui'
import RoleHome from '../RoleHome'

const HomePage = lazy(() => import('./HomePage'))

/**
 * Root route: the public homepage for visitors, the role workspace
 * for signed-in users. No duplicate routes, no forced marketing detour.
 */
export default function HomeRoute() {
  const { user, ready } = useAuth()
  if (!ready) return <PageSkeleton />
  if (user) return <RoleHome />
  return (
    <Suspense fallback={<PageSkeleton />}>
      <HomePage />
    </Suspense>
  )
}
