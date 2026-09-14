import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiRequestError, clearToken, readToken } from '../lib/api'
import { currentUser, login as apiLogin, logout as apiLogout, register as apiRegister } from '../services/auth'
import type { User } from '../lib/types'

interface AuthState {
  user: User | null
  ready: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, fullName: string) => Promise<void>
  signOut: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!readToken()) {
      setReady(true)
      return
    }
    let alive = true
    currentUser()
      .then((u) => {
        if (alive) setUser(u)
      })
      .catch(() => clearToken())
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      setUser(await apiLogin(email, password))
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        throw new Error('Email or password did not match. Try again.')
      }
      throw error
    }
  }, [])

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    setUser(await apiRegister(email, password, fullName))
  }, [])

  const signOut = useCallback(() => {
    apiLogout()
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, ready, signIn, signUp, signOut }), [user, ready, signIn, signUp, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
