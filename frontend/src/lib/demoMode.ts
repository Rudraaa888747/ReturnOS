// Demo-mode signal: the backend rejects authenticated mutations with
// 403 DEMO_MODE when the public demo is read-only. Any api() call that hits
// it notifies subscribers; DemoModeDialog renders the polished message.
type Listener = () => void

const listeners = new Set<Listener>()

export function notifyDemoBlocked(): void {
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      /* a stuck dialog listener must never break the caller */
    }
  })
}

export function onDemoBlocked(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function isDemoBlockedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: number }).status === 403 &&
    'code' in error &&
    (error as { code: string }).code === 'DEMO_MODE'
  )
}
