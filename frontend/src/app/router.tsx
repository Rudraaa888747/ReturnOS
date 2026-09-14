import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { RequireAuth } from '../auth/RequireAuth'
import { Shell } from './Shell'
import { PageSkeleton } from '../components/ui'

const LoginPage = lazy(() => import('../pages/LoginPage'))
const RegisterPage = lazy(() => import('../pages/RegisterPage'))
const ForbiddenPage = lazy(() => import('../pages/ForbiddenPage'))
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'))
const RoleHome = lazy(() => import('../pages/RoleHome'))
const CustomerReturns = lazy(() => import('../pages/customer/CustomerReturns'))
const CustomerReturnDetail = lazy(() => import('../pages/customer/CustomerReturnDetail'))
const NewReturn = lazy(() => import('../pages/customer/NewReturn'))

const OpsDashboard = lazy(() => import('../pages/warehouse/OpsDashboard'))
const WorkQueue = lazy(() => import('../pages/warehouse/WorkQueue'))
const Workspace = lazy(() => import('../pages/warehouse/Workspace'))
const WarehouseTasks = lazy(() => import('../pages/warehouse/WarehouseTasks'))

const AdminDashboard = lazy(() => import('../pages/admin/AdminDashboard'))
const AdminTasks = lazy(() => import('../pages/admin/AdminTasks'))
const AuditExplorer = lazy(() => import('../pages/admin/AuditExplorer'))

function suspended(element: React.ReactNode) {
  return <Suspense fallback={<PageSkeleton />}>{element}</Suspense>
}

export const router = createBrowserRouter([
  { path: '/login', element: suspended(<LoginPage />) },
  { path: '/register', element: suspended(<RegisterPage />) },
  { path: '/403', element: suspended(<ForbiddenPage />) },
  {
    element: (
      <RequireAuth>
        <Shell />
      </RequireAuth>
    ),
    children: [
      // Role landing: staff → /ops, admin → /admin, customers stay here.
      {
        path: '/',
        element: <RequireAuth>{suspended(<RoleHome />)}</RequireAuth>,
      },
      {
        path: '/returns',
        element: (
          <RequireAuth roles={['CUSTOMER']}>
            {suspended(<CustomerReturns />)}
          </RequireAuth>
        ),
      },
      {
        path: '/returns/new',
        element: (
          <RequireAuth roles={['CUSTOMER']}>
            {suspended(<NewReturn />)}
          </RequireAuth>
        ),
      },
      {
        path: '/returns/:id',
        element: (
          <RequireAuth roles={['CUSTOMER']}>
            {suspended(<CustomerReturnDetail />)}
          </RequireAuth>
        ),
      },
      // Warehouse
      {
        path: '/ops',
        element: (
          <RequireAuth roles={['WAREHOUSE_STAFF']}>
            {suspended(<OpsDashboard />)}
          </RequireAuth>
        ),
      },
      {
        path: '/ops/returns',
        element: (
          <RequireAuth roles={['WAREHOUSE_STAFF', 'ADMIN']}>
            {suspended(<WorkQueue />)}
          </RequireAuth>
        ),
      },
      {
        path: '/ops/returns/:id',
        element: (
          <RequireAuth roles={['WAREHOUSE_STAFF', 'ADMIN']}>
            {suspended(<Workspace />)}
          </RequireAuth>
        ),
      },
      {
        path: '/ops/tasks',
        element: (
          <RequireAuth roles={['WAREHOUSE_STAFF']}>
            {suspended(<WarehouseTasks />)}
          </RequireAuth>
        ),
      },
      // Admin (also sees ops queue/workspace above)
      {
        path: '/admin',
        element: (
          <RequireAuth roles={['ADMIN']}>
            {suspended(<AdminDashboard />)}
          </RequireAuth>
        ),
      },
      {
        path: '/admin/tasks',
        element: (
          <RequireAuth roles={['ADMIN']}>
            {suspended(<AdminTasks />)}
          </RequireAuth>
        ),
      },
      {
        path: '/admin/audit',
        element: (
          <RequireAuth roles={['ADMIN']}>
            {suspended(<AuditExplorer />)}
          </RequireAuth>
        ),
      },
      { path: '*', element: suspended(<NotFoundPage />) },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
