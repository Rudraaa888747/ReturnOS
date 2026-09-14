import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import LoginPage from './LoginPage'
import { useAuth } from '../auth/AuthContext'

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }))

function renderLogin(signIn: (email: string, password: string) => Promise<void>) {
  vi.mocked(useAuth).mockReturnValue({ user: null, ready: true, signIn, signUp: vi.fn(), signOut: vi.fn() })
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<p>home screen</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LoginPage', () => {
  it('asks for credentials before calling the API', async () => {
    const user = userEvent.setup()
    const signIn = vi.fn()
    renderLogin(signIn)

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(/email and password/i)).toBeInTheDocument()
    expect(signIn).not.toHaveBeenCalled()
  })

  it('signs in and lands on the requested page', async () => {
    const user = userEvent.setup()
    const signIn = vi.fn().mockResolvedValue(undefined)
    renderLogin(signIn)

    await user.type(screen.getByLabelText(/work email/i), 'customer@returnos.dev')
    await user.type(screen.getByLabelText(/password/i), 'Customer123!')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(signIn).toHaveBeenCalledWith('customer@returnos.dev', 'Customer123!')
    expect(await screen.findByText('home screen')).toBeInTheDocument()
  })

  it('shows backend failures in plain words', async () => {
    const user = userEvent.setup()
    const signIn = vi.fn().mockRejectedValue(new Error('Email or password did not match. Try again.'))
    renderLogin(signIn)

    await user.type(screen.getByLabelText(/work email/i), 'a@b.dev')
    await user.type(screen.getByLabelText(/password/i), 'wrongpassword')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText(/did not match/i)).toBeInTheDocument()
  })
})
