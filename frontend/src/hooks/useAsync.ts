import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../lib/api'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

/** Fetch-on-mount with abort, reload and human-readable errors. */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    setLoading(true)
    setError(null)
    fnRef
      .current(controller.signal)
      .then((value) => {
        if (alive) {
          setData(value)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!alive) return
        const message = errorMessage(err)
        if (message) {
          setError(message)
          setLoading(false)
        }
      })
    return () => {
      alive = false
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, error, loading, reload }
}
