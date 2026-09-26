import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './ProtectedRoute'
import AdminRoute from './AdminRoute'
import WarehouseRoute from './WarehouseRoute'
import { homePathFor, pathMatchesRole } from './roleHome'
import type { PublicUser, UserRole } from '../lib/api'

/**
 * Route guards must keep a signed-in user out of a panel whose API will
 * reject them. Rendering the page anyway produced a fully drawn layout
 * followed by "Something could not be loaded" — the bug these cover.
 */

type Session = { user: PublicUser | null; ready: boolean }
let session: Session = { user: null, ready: true }

vi.mock('../lib/session', () => ({
  useSession: () => session,
}))

function userWith(role: UserRole): PublicUser {
  return { id: `u-${role}`, email: `${role.toLowerCase()}@returnos.test`, fullName: 'Demo', role }
}

/** Render the three guarded panels and report where `start` lands. */
function landingFrom(start: string): string {
  render(
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/login" element={<p>login page</p>} />
        <Route
          path="/customer"
          element={
            <ProtectedRoute>
              <p>customer panel</p>
            </ProtectedRoute>
          }
        />
        <Route
          path="/warehouse"
          element={
            <WarehouseRoute>
              <p>warehouse panel</p>
            </WarehouseRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <p>admin panel</p>
            </AdminRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  for (const label of ['login page', 'customer panel', 'warehouse panel', 'admin panel']) {
    if (screen.queryByText(label) !== null) return label
  }
  return 'nothing rendered'
}

beforeEach(() => {
  session = { user: null, ready: true }
})

describe('ProtectedRoute', () => {
  it('waits while the session is still resolving', () => {
    session = { user: null, ready: false }
    // Must not redirect on a not-yet-known session, or a reload would bounce
    // a signed-in customer to the login page.
    expect(landingFrom('/customer')).toBe('nothing rendered')
  })

  it('sends an anonymous visitor to login', () => {
    expect(landingFrom('/customer')).toBe('login page')
  })

  it('sends a warehouse operator to their own panel', () => {
    session = { user: userWith('WAREHOUSE'), ready: true }
    expect(landingFrom('/customer')).toBe('warehouse panel')
  })

  it('sends an admin to their own panel', () => {
    session = { user: userWith('ADMIN'), ready: true }
    expect(landingFrom('/customer')).toBe('admin panel')
  })

  it('renders the customer panel for a customer', () => {
    session = { user: userWith('CUSTOMER'), ready: true }
    expect(landingFrom('/customer')).toBe('customer panel')
  })
})

describe('the other guards behave the same way', () => {
  it('keeps a customer out of the warehouse panel', () => {
    session = { user: userWith('CUSTOMER'), ready: true }
    expect(landingFrom('/warehouse')).toBe('customer panel')
  })

  it('keeps a customer out of the admin panel', () => {
    session = { user: userWith('CUSTOMER'), ready: true }
    expect(landingFrom('/admin')).toBe('customer panel')
  })

  it('sends an admin on a warehouse URL straight to admin, without bouncing', () => {
    // Previously this redirected to /customer, which then had to redirect
    // again. One hop keeps the history sane.
    session = { user: userWith('ADMIN'), ready: true }
    expect(landingFrom('/warehouse')).toBe('admin panel')
  })

  it('sends an operator on an admin URL straight to the warehouse', () => {
    session = { user: userWith('WAREHOUSE'), ready: true }
    expect(landingFrom('/admin')).toBe('warehouse panel')
  })

  it('sends anonymous visitors on any panel to login', () => {
    for (const path of ['/customer', '/warehouse', '/admin']) {
      expect(landingFrom(path)).toBe('login page')
      cleanup()
    }
  })
})

describe('role home mapping', () => {
  it('maps each role to its own panel', () => {
    expect(homePathFor('CUSTOMER')).toBe('/customer')
    expect(homePathFor('WAREHOUSE')).toBe('/warehouse')
    expect(homePathFor('ADMIN')).toBe('/admin')
  })

  it('recognises paths inside a role panel, and only those', () => {
    expect(pathMatchesRole('/customer', 'CUSTOMER')).toBe(true)
    expect(pathMatchesRole('/customer/orders/123', 'CUSTOMER')).toBe(true)
    expect(pathMatchesRole('/customer/orders', 'WAREHOUSE')).toBe(false)
    expect(pathMatchesRole('/warehouse/returns', 'WAREHOUSE')).toBe(true)
    expect(pathMatchesRole('/admin/users', 'ADMIN')).toBe(true)
    // A prefix that merely starts with the panel name is not inside it.
    expect(pathMatchesRole('/customer-portal', 'CUSTOMER')).toBe(false)
  })
})
