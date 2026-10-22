import { eq } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'

// For the public invite page: the invitation and its shop, or null when it can't be used
// (unknown id, accepted/cancelled, or expired)
export async function getOpenInvitation(id: string) {
  const [row] = await db
    .select({ invitation: schema.shopInvitations, shopName: schema.shops.name })
    .from(schema.shopInvitations)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.shopInvitations.organizationId))
    .where(eq(schema.shopInvitations.id, id))
  if (!row || row.invitation.status !== 'pending' || row.invitation.expiresAt < new Date()) return null
  return { ...row.invitation, shopName: row.shopName }
}

export async function userExists(email: string) {
  const [row] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email.toLowerCase()))
  return Boolean(row)
}
