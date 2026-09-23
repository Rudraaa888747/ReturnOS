import { createBrowserRouter } from 'react-router-dom'
import HomeRoute from '../pages/home/HomeRoute'
import Login from '../pages/public/Login'
import Signup from '../pages/public/Signup'
import ForgotPassword from '../pages/public/ForgotPassword'
import ResetPassword from '../pages/public/ResetPassword'
import NotFound from '../pages/public/NotFound'
import ProtectedRoute from './ProtectedRoute'
import WarehouseRoute from './WarehouseRoute'
import AdminRoute from './AdminRoute'
import CustomerLayout from '../pages/customer/Layout'
import Dashboard from '../pages/customer/Dashboard'
import Store from '../pages/customer/Store'
import ProductDetail from '../pages/customer/ProductDetail'
import Cart from '../pages/customer/Cart'
import Checkout from '../pages/customer/Checkout'
import Orders from '../pages/customer/Orders'
import OrderDetail from '../pages/customer/OrderDetail'
import Returns from '../pages/customer/Returns'
import ReturnDetail from '../pages/customer/ReturnDetail'
import NewReturn from '../pages/customer/NewReturn'
import Track from '../pages/customer/Track'
import Notifications from '../pages/customer/Notifications'
import Documents from '../pages/customer/Documents'
import Addresses from '../pages/customer/Addresses'
import Profile from '../pages/customer/Profile'
import Settings from '../pages/customer/Settings'
import Support from '../pages/customer/Support'
import SupportDetail from '../pages/customer/SupportDetail'
import WarehouseLayout from '../pages/warehouse/Layout'
import WarehouseDashboard from '../pages/warehouse/Dashboard'
import ReturnQueue from '../pages/warehouse/Queue'
import WarehouseReturnDetail from '../pages/warehouse/ReturnDetail'
import WarehouseInventory from '../pages/warehouse/Inventory'
import WarehouseShipments from '../pages/warehouse/Shipments'
import WarehouseTasks from '../pages/warehouse/Tasks'
import WarehouseAnalytics from '../pages/warehouse/Analytics'
import AdminLayout from '../pages/admin/Layout'
import AdminDashboard from '../pages/admin/Dashboard'
import AdminCustomers from '../pages/admin/Customers'
import AdminCustomerDetail from '../pages/admin/CustomerDetail'
import AdminOrders from '../pages/admin/Orders'
import AdminOrderDetail from '../pages/admin/OrderDetail'
import AdminReturns from '../pages/admin/Returns'
import AdminReturnDetail from '../pages/admin/ReturnDetail'
import AdminWarehouses from '../pages/admin/Warehouses'
import AdminWarehouseDetail from '../pages/admin/WarehouseDetail'
import AdminInventory from '../pages/admin/Inventory'
import AdminWorkload from '../pages/admin/Workload'
import AdminUsers from '../pages/admin/Users'
import AdminProducts from '../pages/admin/Products'
import AdminProductDetail from '../pages/admin/ProductDetail'
import AdminCategories from '../pages/admin/Categories'
import AdminCredit from '../pages/admin/Credit'
import AdminRefunds from '../pages/admin/Refunds'
import AdminSettings from '../pages/admin/Settings'
import AdminSupport from '../pages/admin/Support'
import AdminSupportDetail from '../pages/admin/SupportDetail'
import AdminNotifications from '../pages/admin/Notifications'
import AdminReports from '../pages/admin/Reports'
import AdminAnalytics from '../pages/admin/Analytics'
import AdminAccounts from '../pages/admin/AdminUsers'
import AdminAudit from '../pages/admin/Audit'

export const router = createBrowserRouter([
  { path: '/', element: <HomeRoute /> },
  { path: '/login', element: <Login /> },
  { path: '/signup', element: <Signup /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  { path: '/reset-password', element: <ResetPassword /> },
  {
    path: '/customer',
    element: (
      <ProtectedRoute>
        <CustomerLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'store', element: <Store /> },
      { path: 'store/products/:id', element: <ProductDetail /> },
      { path: 'cart', element: <Cart /> },
      { path: 'checkout', element: <Checkout /> },
      { path: 'orders', element: <Orders /> },
      { path: 'orders/:id', element: <OrderDetail /> },
      { path: 'returns', element: <Returns /> },
      { path: 'returns/new', element: <NewReturn /> },
      { path: 'returns/:id', element: <ReturnDetail /> },
      { path: 'track', element: <Track /> },
      { path: 'notifications', element: <Notifications /> },
      { path: 'documents', element: <Documents /> },
      { path: 'addresses', element: <Addresses /> },
      { path: 'profile', element: <Profile /> },
      { path: 'settings', element: <Settings /> },
      { path: 'support', element: <Support /> },
      { path: 'support/:id', element: <SupportDetail /> },
    ],
  },
  {
    path: '/warehouse',
    element: (
      <WarehouseRoute>
        <WarehouseLayout />
      </WarehouseRoute>
    ),
    children: [
      { index: true, element: <WarehouseDashboard /> },
      { path: 'returns', element: <ReturnQueue /> },
      { path: 'returns/:id', element: <WarehouseReturnDetail /> },
      { path: 'inventory', element: <WarehouseInventory /> },
      { path: 'shipments', element: <WarehouseShipments /> },
      { path: 'tasks', element: <WarehouseTasks /> },
      { path: 'analytics', element: <WarehouseAnalytics /> },
    ],
  },
  {
    path: '/admin',
    element: (
      <AdminRoute>
        <AdminLayout />
      </AdminRoute>
    ),
    children: [
      { index: true, element: <AdminDashboard /> },
      { path: 'customers', element: <AdminCustomers /> },
      { path: 'customers/:id', element: <AdminCustomerDetail /> },
      { path: 'orders', element: <AdminOrders /> },
      { path: 'orders/:id', element: <AdminOrderDetail /> },
      { path: 'returns', element: <AdminReturns /> },
      { path: 'returns/:id', element: <AdminReturnDetail /> },
      { path: 'warehouses', element: <AdminWarehouses /> },
      { path: 'warehouses/:id', element: <AdminWarehouseDetail /> },
      { path: 'inventory', element: <AdminInventory /> },
      { path: 'workload', element: <AdminWorkload /> },
      { path: 'users', element: <AdminUsers /> },
      { path: 'products', element: <AdminProducts /> },
      { path: 'products/:id', element: <AdminProductDetail /> },
      { path: 'categories', element: <AdminCategories /> },
      { path: 'credit', element: <AdminCredit /> },
      { path: 'refunds', element: <AdminRefunds /> },
      { path: 'settings', element: <AdminSettings /> },
      { path: 'support', element: <AdminSupport /> },
      { path: 'support/:id', element: <AdminSupportDetail /> },
      { path: 'notifications', element: <AdminNotifications /> },
      { path: 'reports', element: <AdminReports /> },
      { path: 'analytics', element: <AdminAnalytics /> },
      { path: 'accounts', element: <AdminAccounts /> },
      { path: 'audit', element: <AdminAudit /> },
    ],
  },
  { path: '*', element: <NotFound /> },
])

export default router
