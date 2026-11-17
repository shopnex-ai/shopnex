// Platform-level roles (Better Auth admin plugin) — separate from per-shop roles (owner/admin/member).
// Safe to import from client code.
export const SUPER_ADMIN_ROLE = 'superadmin'

export function isSuperAdmin(user: { role?: string | null }) {
  return user.role === SUPER_ADMIN_ROLE
}

// Shop invitations (organization plugin): the number of days belongs to tenancy, whose Staff page offers the same
export { INVITATION_EXPIRES_IN_DAYS } from '@shopnex/tenancy/schema'
