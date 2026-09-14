import { Suspense, lazy } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { PageSkeleton } from '../components/ui'

const CustomerDashboard = lazy(() => import('./customer/CustomerDashboard'))

export default function RoleHome() {
  const { user } = useAuth()
  if (user?.role === 'ADMIN') return <Navigate to="/admin" replace />
  if (user?.role === 'WAREHOUSE_STAFF') return <Navigate to="/ops" replace />
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CustomerDashboard />
    </Suspense>
  )
}
