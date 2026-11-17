import { and, eq } from 'drizzle-orm'
import { db } from '@shopnex/db'
import { canActInShop, isMultiTenant } from '@shopnex/tenancy'
import { session } from './auth.schema'

/**
 * Makes `shopId` the session's active shop. False when the user may not act in it (not a member, and not a super admin) or it
 * doesn't exist, and always false outside multi-shop mode. Written to the session directly, since Better Auth's setActive
 * requires membership and super admins act in shops they aren't members of.
 */
export async function setActiveShop(input: { sessionId: string; userId: string; superAdmin: boolean; shopId: string }) {
  if (!isMultiTenant) return false
  if (!(await canActInShop(input))) return false
  await db
    .update(session)
    .set({ activeOrganizationId: input.shopId })
    .where(and(eq(session.id, input.sessionId), eq(session.userId, input.userId)))
  return true
}
