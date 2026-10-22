import { and, eq, like, ne, or } from 'drizzle-orm'
import { schema, type Conn } from '@shopnex/db'
export { SLUG_PATTERN } from '@shopnex/db/schema'

// "Été 2026!" → "ete-2026". Matches the backfill in migration 0005 for ASCII titles.
export function slugify(input: string, fallback = 'item'): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

type SluggedTable = typeof schema.products | typeof schema.collections

export async function isSlugTaken(conn: Conn, table: SluggedTable, shopId: string, slug: string, excludeId?: string) {
  const [row] = await conn
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.shopId, shopId), eq(table.slug, slug), excludeId ? ne(table.id, excludeId) : undefined))
    .limit(1)
  return !!row
}

// First free slug among base, base-2, base-3… within one shop
export async function nextFreeSlug(conn: Conn, table: SluggedTable, shopId: string, base: string) {
  const rows = await conn
    .select({ slug: table.slug })
    .from(table)
    .where(and(eq(table.shopId, shopId), or(eq(table.slug, base), like(table.slug, `${base}-%`))))
  const taken = new Set(rows.map((r) => r.slug))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}
