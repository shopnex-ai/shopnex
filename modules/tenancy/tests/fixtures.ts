// What the tenancy tests share: the embedded database and a few rows. TENANCY_MODE, ROOT_DOMAIN and the rest are read when
// @shopnex/tenancy first loads, so a test file sets them first and imports this file after (`await import('./fixtures')`).
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, schema, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
const { shopInvitations, shopMembers } = await import('../src/tenancy.schema')
requireEmbeddedDatabase()
const { eq, inArray } = await import('drizzle-orm')

export { db, schema, prepareDatabase, eq }

let counter = 0
export const unique = () => `${Date.now().toString(36)}${(++counter).toString(36)}`
const made = { users: [] as string[], shops: [] as string[], members: [] as string[] }

export async function user(patch: Partial<typeof schema.user.$inferInsert> = {}) {
  const id = `u-${unique()}`
  const [row] = await db
    .insert(schema.user)
    .values({ id, name: `User ${id}`, email: `${id}@example.test`, ...patch })
    .returning()
  made.users.push(id)
  return row!
}

export async function shop(patch: Partial<typeof schema.shops.$inferInsert> = {}) {
  const id = `s-${unique()}`
  const [row] = await db
    .insert(schema.shops)
    .values({ id, name: `Shop ${id}`, slug: id, ...patch })
    .returning()
  made.shops.push(row!.id)
  return row!
}

export async function member(shopId: string, userId: string, role = 'member', createdAt?: Date) {
  const id = `m-${unique()}`
  const [row] = await db
    .insert(shopMembers)
    .values({ id, organizationId: shopId, userId, role, ...(createdAt ? { createdAt } : {}) })
    .returning()
  made.members.push(id)
  return row!
}

export async function invitation(
  shopId: string,
  inviterId: string,
  patch: Partial<typeof shopInvitations.$inferInsert> = {},
) {
  const id = `i-${unique()}`
  const [row] = await db
    .insert(shopInvitations)
    .values({
      id,
      organizationId: shopId,
      email: `${id}@example.test`,
      role: 'member',
      status: 'pending',
      expiresAt: new Date(Date.now() + 3600_000),
      inviterId,
      ...patch,
    })
    .returning()
  return row!
}

/** Everything the tests made (shops take their members, domains, tokens, keys and invitations with them) */
export async function cleanup() {
  if (made.members.length) await db.delete(shopMembers).where(inArray(shopMembers.id, made.members))
  if (made.shops.length) await db.delete(schema.shops).where(inArray(schema.shops.id, made.shops))
  if (made.users.length) await db.delete(schema.user).where(inArray(schema.user.id, made.users))
  for (const list of Object.values(made)) list.length = 0
}
