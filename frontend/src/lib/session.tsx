import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError, api, getToken, setToken } from './api'
import type { PublicUser } from './api'

interface SessionState {
  user: PublicUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (fullName: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

interface MeResponse {
  user: PublicUser;
}

interface AuthResponse {
  user: PublicUser;
  token: string;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null)
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    const token = getToken()
    if (!token) {
      setUser(null)
      setReady(true)
      return
    }
    try {
      const me = await api<MeResponse>('/auth/me')
      setUser(me.user)
    } catch (err) {
      // Only a rejected token means logged out. A transient network failure
      // must never wipe stored credentials: that turns a blip into a forced
      // logout and strands the user on the login page mid-session.
      if (err instanceof ApiError && err.status === 401) {
        setToken(null)
      }
      setUser(null)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (email: string, password: string) => {
    const response = await api<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    setToken(response.token)
    setUser(response.user)
  }, [])

  const signup = useCallback(async (fullName: string, email: string, password: string) => {
    const response = await api<AuthResponse>('/auth/signup', {
      method: 'POST',
      body: { fullName, email, password },
    })
    setToken(response.token)
    setUser(response.user)
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, ready, login, signup, logout, refresh }),
    [user, ready, login, signup, logout, refresh],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/**
 * Session state when a provider is present, otherwise null.
 *
 * Lets a component adapt to who is signed in without requiring a
 * SessionProvider, which keeps standalone unit tests renderable.
 */
export function useOptionalSession(): SessionState | null {
  return useContext(SessionContext)
}

export function useSession(): SessionState {
  const state = useContext(SessionContext)
  if (!state) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return state
}
