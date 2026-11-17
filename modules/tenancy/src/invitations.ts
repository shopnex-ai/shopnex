import { eq } from 'drizzle-orm'
import { db } from '@shopnex/db'
import { shopInvitations } from './tenancy.schema'
import { shops, user } from '@shopnex/core/schema'

// For the public invite page: the invitation and its shop, or null when it can't be used
// (unknown id, accepted/cancelled, or expired)
export async function getOpenInvitation(id: string) {
  const [row] = await db
    .select({ invitation: shopInvitations, shopName: shops.name })
    .from(shopInvitations)
    .innerJoin(shops, eq(shops.id, shopInvitations.organizationId))
    .where(eq(shopInvitations.id, id))
  if (!row || row.invitation.status !== 'pending' || row.invitation.expiresAt < new Date()) return null
  return { ...row.invitation, shopName: row.shopName }
}

export async function userExists(email: string) {
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()))
  return Boolean(row)
}
