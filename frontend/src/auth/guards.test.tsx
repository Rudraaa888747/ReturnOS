import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './RequireAuth'
import { useAuth } from './AuthContext'
import type { User } from '../lib/types'

vi.mock('./AuthContext', () => ({ useAuth: vi.fn() }))

const staff: User = { id: 'u1', email: 's@x.dev', fullName: 'Staff', role: 'WAREHOUSE_STAFF', enabled: true }
const customer: User = { id: 'u2', email: 'c@x.dev', fullName: 'Customer', role: 'CUSTOMER', enabled: true }

function renderAt(path: string, roles?: ('CUSTOMER' | 'WAREHOUSE_STAFF' | 'ADMIN')[]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<p>login screen</p>} />
        <Route path="/403" element={<p>forbidden screen</p>} />
        <Route
          path="/ops"
          element={
            <RequireAuth roles={roles}>
              <p>ops screen</p>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireAuth', () => {
  it('sends anonymous users to login', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, ready: true } as never)
    renderAt('/ops')
    expect(screen.getByText('login screen')).toBeInTheDocument()
  })

  it('sends wrong-role users to the forbidden page', () => {
    vi.mocked(useAuth).mockReturnValue({ user: customer, ready: true } as never)
    renderAt('/ops', ['WAREHOUSE_STAFF'])
    expect(screen.getByText('forbidden screen')).toBeInTheDocument()
  })

  it('lets the right role through', () => {
    vi.mocked(useAuth).mockReturnValue({ user: staff, ready: true } as never)
    renderAt('/ops', ['WAREHOUSE_STAFF'])
    expect(screen.getByText('ops screen')).toBeInTheDocument()
  })
})
