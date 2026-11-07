import { and, count, desc, gte, ilike, or, sql, type SQL } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'

// Platform-wide numbers for super admins: every shop and user on the install, whatever shop they are acting in.
// Read-only; callers must check the platform role (the API does, with superAdminOnly).
//
// The per-row counts are subqueries written out with table aliases: Drizzle drops table prefixes from columns
// interpolated into a select, so `id` and `shop_id` would resolve to the inner table instead of the listed row.

const RECENT_DAYS = 7

type Paging = { limit: number; offset: number; search?: string }

const likePattern = (search: string) => `%${search.replace(/[\\%_]/g, '\\$&')}%`

export async function overview(now = new Date()) {
  const since = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000)
  const [[shops], [users], [recentShops], [recentUsers]] = await Promise.all([
    db.select({ total: count() }).from(schema.shops),
    db.select({ total: count() }).from(schema.user),
    db.select({ total: count() }).from(schema.shops).where(gte(schema.shops.createdAt, since)),
    db.select({ total: count() }).from(schema.user).where(gte(schema.user.createdAt, since)),
  ])
  return {
    shops: shops?.total ?? 0,
    users: users?.total ?? 0,
    newShops: recentShops?.total ?? 0,
    newUsers: recentUsers?.total ?? 0,
    recentDays: RECENT_DAYS,
  }
}

// Newest first. Each row carries its member and order counts and its owner's email.
export async function listShops({ limit, offset, search }: Paging) {
  const where = search
    ? or(ilike(schema.shops.name, likePattern(search)), ilike(schema.shops.slug, likePattern(search)))
    : undefined
  const [items, [counted]] = await Promise.all([
    db
      .select({
        id: schema.shops.id,
        name: schema.shops.name,
        slug: schema.shops.slug,
        currency: schema.shops.currency,
        createdAt: schema.shops.createdAt,
        members: sql<number>`(select count(*)::int from shop_members sm where sm.shop_id = shops.id)`,
        orders: sql<number>`(select count(*)::int from orders o where o.shop_id = shops.id)`,
        ownerEmail: sql<
          string | null
        >`(select u.email from shop_members sm inner join "user" u on u.id = sm.user_id where sm.shop_id = shops.id and sm.role = 'owner' order by sm.created_at limit 1)`,
      })
      .from(schema.shops)
      .where(where)
      .orderBy(desc(schema.shops.createdAt), desc(schema.shops.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(schema.shops).where(where),
  ])
  return { items, total: counted?.total ?? 0 }
}

// Newest first, which makes page one the latest signups. Each row carries the number of shops the user belongs to.
export async function listUsers({ limit, offset, search }: Paging) {
  const filters: (SQL | undefined)[] = []
  if (search) {
    const pattern = likePattern(search)
    filters.push(or(ilike(schema.user.email, pattern), ilike(schema.user.name, pattern)))
  }
  const where = and(...filters)
  const [items, [counted]] = await Promise.all([
    db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        role: schema.user.role,
        banned: schema.user.banned,
        createdAt: schema.user.createdAt,
        shops: sql<number>`(select count(*)::int from shop_members sm where sm.user_id = "user".id)`,
      })
      .from(schema.user)
      .where(where)
      .orderBy(desc(schema.user.createdAt), desc(schema.user.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(schema.user).where(where),
  ])
  return { items, total: counted?.total ?? 0 }
}
