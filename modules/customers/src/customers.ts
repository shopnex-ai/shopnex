// Business logic only — no HTTP / oRPC / Hono imports in this module.
// Every query is scoped by shopId; there is deliberately no unscoped variant.
import { and, count, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'
import type { NewCustomer } from '@shopnex/db/schema'
import { emit } from '@shopnex/webhooks'

type CustomerInput = Pick<NewCustomer, 'email' | 'name' | 'phone' | 'userId'>

const normalizeEmail = (email: string) => email.trim().toLowerCase()

// `search` matches email or name (case-insensitive, substring)
export async function list(shopId: string, opts: { limit: number; offset: number; search?: string }, conn: Conn = db) {
  const filters: (SQL | undefined)[] = [eq(schema.customers.shopId, shopId)]
  if (opts.search) {
    const pattern = `%${opts.search.replace(/[\\%_]/g, '\\$&')}%`
    filters.push(or(ilike(schema.customers.email, pattern), ilike(schema.customers.name, pattern)))
  }
  const where = and(...filters)
  const [items, [counted]] = await Promise.all([
    conn
      .select()
      .from(schema.customers)
      .where(where)
      .orderBy(desc(schema.customers.createdAt))
      .limit(opts.limit)
      .offset(opts.offset),
    conn.select({ total: count() }).from(schema.customers).where(where),
  ])
  return { items, total: counted?.total ?? 0 }
}

export async function getById(shopId: string, id: string, conn: Conn = db) {
  const [row] = await conn
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.shopId, shopId), eq(schema.customers.id, id)))
  return row ?? null
}

export async function getByEmail(shopId: string, email: string, conn: Conn = db) {
  const [row] = await conn
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.shopId, shopId), eq(schema.customers.email, normalizeEmail(email))))
  return row ?? null
}

// Returns null when the email is already taken in this shop
export async function create(shopId: string, input: CustomerInput, conn: Conn = db) {
  const [row] = await conn
    .insert(schema.customers)
    .values({ ...input, email: normalizeEmail(input.email), shopId })
    .onConflictDoNothing()
    .returning()
  if (row) await emit(conn, shopId, 'customer.created', () => row)
  return row ?? null
}

// Returns null when not found. Callers check email uniqueness first (getByEmail).
export async function update(
  shopId: string,
  id: string,
  patch: Partial<Pick<NewCustomer, 'email' | 'name' | 'phone'>>,
  conn: Conn = db,
) {
  const [row] = await conn
    .update(schema.customers)
    .set({ ...patch, ...(patch.email && { email: normalizeEmail(patch.email) }), updatedAt: new Date() })
    .where(and(eq(schema.customers.shopId, shopId), eq(schema.customers.id, id)))
    .returning()
  if (row) await emit(conn, shopId, 'customer.updated', () => row)
  return row ?? null
}

export async function removeMany(shopId: string, ids: string[]) {
  if (!ids.length) return 0
  const deleted = await db
    .delete(schema.customers)
    .where(and(eq(schema.customers.shopId, shopId), inArray(schema.customers.id, ids)))
    .returning({ id: schema.customers.id })
  return deleted.length
}

// Used by checkout: guests are matched by email within the shop
export async function findOrCreateByEmail(shopId: string, input: CustomerInput, conn: Conn = db) {
  return (await create(shopId, input, conn)) ?? (await getByEmail(shopId, input.email, conn))!
}
