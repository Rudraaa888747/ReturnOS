import type { UserRole } from '../lib/api'

/**
 * The panel a role belongs in.
 *
 * Every route guard and the post-login redirect share this one mapping, so a
 * signed-in user can never be left on a panel whose API will reject them —
 * the failure that produced a rendered page followed by an error card.
 */
export function homePathFor(role: UserRole): string {
  switch (role) {
    case 'WAREHOUSE':
      return '/warehouse'
    case 'ADMIN':
      return '/admin'
    default:
      return '/customer'
  }
}

/** Whether `path` belongs to the panel this role is allowed to use. */
export function pathMatchesRole(path: string, role: UserRole): boolean {
  const home = homePathFor(role)
  return path === home || path.startsWith(`${home}/`)
}
