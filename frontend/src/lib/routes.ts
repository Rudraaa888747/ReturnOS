/* Single source of truth for known authenticated routes.
   Used to validate post-login "from" targets so a stale or forged path
   can never land a fresh session on the 404 page. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STATIC_ROUTES = new Set([
  '/home',
  '/returns',
  '/returns/new',
  '/ops',
  '/ops/returns',
  '/ops/tasks',
  '/admin',
  '/admin/tasks',
  '/admin/audit',
])

const DYNAMIC_PREFIXES = ['/returns/', '/ops/returns/']

export function isKnownAppPath(path: string): boolean {
  if (typeof path !== 'string' || !path.startsWith('/')) return false
  // Reject absolute URLs, protocol tricks, traversal and encoding games.
  if (path.startsWith('//') || path.includes('\\') || path.includes('..') || path.includes('%')) return false
  if (STATIC_ROUTES.has(path)) return true
  for (const prefix of DYNAMIC_PREFIXES) {
    if (path.startsWith(prefix)) {
      const id = path.slice(prefix.length)
      // Exactly one segment, and it must look like a real entity id (UUIDs in this app).
      if (id.length > 0 && !id.includes('/') && UUID_RE.test(id)) return true
      return false
    }
  }
  return false
}

/** Post-login destination: the remembered path when valid, else the role-aware root. */
export function resolvePostLoginPath(from: unknown): string {
  return typeof from === 'string' && isKnownAppPath(from) ? from : '/'
}
