// Shop staff: members and invitations (Better Auth organization tables). Managed here rather than through
// Better Auth's organization endpoints, which only accept the shop's own members — super admins can manage
// every shop. Invitees still accept through Better Auth (/organization/accept-invitation), which reads these rows.
import { randomBytes } from 'node:crypto'
import { and, asc, eq, gt, sql } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import type { StaffRole } from '@shopnex/db/schema'
import type { ShopRole } from './resolve'

export type StaffErrorCode = 'NOT_FOUND' | 'ALREADY_MEMBER' | 'FORBIDDEN'

export class StaffError extends Error {
  constructor(
    readonly code: StaffErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'StaffError'
  }
}

// Who is acting: their role in this shop (super admins act as owners) and user id
export type Actor = { userId: string; role: ShopRole; superAdmin: boolean }

// Owners and super admins manage anyone but owners; admins manage plain staff only. Nobody edits themselves.
function assertCanManage(actor: Actor, target: { userId: string; role: string }) {
  if (target.userId === actor.userId) throw new StaffError('FORBIDDEN', "You can't change your own access")
  if (target.role === 'owner') throw new StaffError('FORBIDDEN', "Owners can't be changed here")
  if (target.role === 'admin' && !actor.superAdmin && actor.role !== 'owner') {
    throw new StaffError('FORBIDDEN', 'Only owners can change admins')
  }
}

export async function listMembers(shopId: string) {
  return (
    db
      .select({
        id: schema.shopMembers.id,
        userId: schema.shopMembers.userId,
        role: schema.shopMembers.role,
        createdAt: schema.shopMembers.createdAt,
        name: schema.user.name,
        email: schema.user.email,
      })
      .from(schema.shopMembers)
      .innerJoin(schema.user, eq(schema.user.id, schema.shopMembers.userId))
      .where(eq(schema.shopMembers.organizationId, shopId))
      // Owners, then admins, then staff (created_at isn't comparable: Better Auth writes it from JS, defaultNow() from the DB)
      .orderBy(
        sql`case ${schema.shopMembers.role} when 'owner' then 0 when 'admin' then 1 else 2 end`,
        asc(schema.user.name),
      )
  )
}

// Pending and not expired
export async function listInvitations(shopId: string) {
  return db
    .select()
    .from(schema.shopInvitations)
    .where(
      and(
        eq(schema.shopInvitations.organizationId, shopId),
        eq(schema.shopInvitations.status, 'pending'),
        gt(schema.shopInvitations.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(schema.shopInvitations.createdAt))
}

// Re-inviting an email replaces its open invitation (fresh link and expiry)
export async function invite(
  shopId: string,
  actor: Actor,
  input: { email: string; role: StaffRole },
  expiresInDays: number,
) {
  const email = input.email.trim().toLowerCase()
  if (input.role === 'admin' && !actor.superAdmin && actor.role !== 'owner') {
    throw new StaffError('FORBIDDEN', 'Only owners can invite admins')
  }
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: schema.shopMembers.id })
      .from(schema.shopMembers)
      .innerJoin(schema.user, eq(schema.user.id, schema.shopMembers.userId))
      .where(and(eq(schema.shopMembers.organizationId, shopId), eq(schema.user.email, email)))
    if (existing) throw new StaffError('ALREADY_MEMBER', `${email} is already a member of this shop`)

    await tx
      .update(schema.shopInvitations)
      .set({ status: 'canceled' })
      .where(
        and(
          eq(schema.shopInvitations.organizationId, shopId),
          eq(sql`lower(${schema.shopInvitations.email})`, email),
          eq(schema.shopInvitations.status, 'pending'),
        ),
      )
    const [invitation] = await tx
      .insert(schema.shopInvitations)
      .values({
        // The id is the secret in the invite link: random, unguessable
        id: randomBytes(24).toString('base64url'),
        organizationId: shopId,
        email,
        role: input.role,
        status: 'pending',
        expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
        inviterId: actor.userId,
      })
      .returning()
    return invitation!
  })
}

// Returns null when there is no open invitation with this id in the shop
export async function cancelInvitation(shopId: string, id: string) {
  const [invitation] = await db
    .update(schema.shopInvitations)
    .set({ status: 'canceled' })
    .where(
      and(
        eq(schema.shopInvitations.organizationId, shopId),
        eq(schema.shopInvitations.id, id),
        eq(schema.shopInvitations.status, 'pending'),
      ),
    )
    .returning()
  return invitation ?? null
}

async function getMember(shopId: string, memberId: string) {
  const [member] = await db
    .select()
    .from(schema.shopMembers)
    .where(and(eq(schema.shopMembers.organizationId, shopId), eq(schema.shopMembers.id, memberId)))
  if (!member) throw new StaffError('NOT_FOUND', 'Member not found')
  return member
}

export async function updateRole(shopId: string, actor: Actor, memberId: string, role: StaffRole) {
  const member = await getMember(shopId, memberId)
  assertCanManage(actor, member)
  if (role === 'admin' && !actor.superAdmin && actor.role !== 'owner') {
    throw new StaffError('FORBIDDEN', 'Only owners can make someone an admin')
  }
  const [updated] = await db
    .update(schema.shopMembers)
    .set({ role })
    .where(eq(schema.shopMembers.id, memberId))
    .returning()
  return updated!
}

// Removes access to this shop; the account itself stays
export async function removeMember(shopId: string, actor: Actor, memberId: string) {
  const member = await getMember(shopId, memberId)
  assertCanManage(actor, member)
  await db.delete(schema.shopMembers).where(eq(schema.shopMembers.id, memberId))
  return member
}
