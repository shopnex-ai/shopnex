// URL redirects (admin: Online store → URL redirects). A visitor who asks the storefront for `fromPath` and would get
// a 404 is sent to `toPath` instead (301). They come from the merchant, from an import, or from `record`, which a
// product, collection or page calls when its handle changes so the old link keeps working.
// Every query is scoped by shopId.
import { and, asc, count, eq, ilike, inArray, or } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'
import { CatalogError } from './errors'

export type RedirectInput = { fromPath: string; toPath: string }

/** "/products/old/" → "/products/old". Must be a path on the storefront, without a query or fragment. */
export function normalizeFrom(input: string) {
  const path = input.trim()
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new CatalogError('REDIRECT_INVALID', 'The old URL must be a path that starts with /, like /products/old')
  }
  if (/[?#\s]/.test(path)) {
    throw new CatalogError('REDIRECT_INVALID', 'The old URL cannot contain a query, a fragment or spaces')
  }
  const trimmed = path.replace(/\/+$/, '')
  if (!trimmed) throw new CatalogError('REDIRECT_INVALID', 'The front page cannot be redirected')
  return trimmed
}

/** A path on the storefront ("/products/new?x=1") or a full http(s) URL */
export function normalizeTo(input: string) {
  const target = input.trim()
  if (target.startsWith('/') && !target.startsWith('//') && !/\s/.test(target)) return target
  try {
    const url = new URL(target)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString()
  } catch {
    // falls through to the error
  }
  throw new CatalogError('REDIRECT_INVALID', 'The new URL must be a path like /products/new or a full http(s) URL')
}

function normalize(input: RedirectInput) {
  const fromPath = normalizeFrom(input.fromPath)
  const toPath = normalizeTo(input.toPath)
  if (fromPath === toPath) throw new CatalogError('REDIRECT_INVALID', 'A URL cannot redirect to itself')
  return { fromPath, toPath }
}

export async function list(shopId: string, opts: { search?: string; limit: number; offset: number }, conn: Conn = db) {
  const pattern = opts.search ? `%${opts.search.replace(/[\\%_]/g, '\\$&')}%` : null
  const where = and(
    eq(schema.redirects.shopId, shopId),
    pattern ? or(ilike(schema.redirects.fromPath, pattern), ilike(schema.redirects.toPath, pattern)) : undefined,
  )
  const [items, [counted]] = await Promise.all([
    conn
      .select()
      .from(schema.redirects)
      .where(where)
      .orderBy(asc(schema.redirects.fromPath))
      .limit(opts.limit)
      .offset(opts.offset),
    conn.select({ total: count() }).from(schema.redirects).where(where),
  ])
  return { items, total: counted?.total ?? 0 }
}

export async function getById(shopId: string, id: string, conn: Conn = db) {
  const [row] = await conn
    .select()
    .from(schema.redirects)
    .where(and(eq(schema.redirects.shopId, shopId), eq(schema.redirects.id, id)))
  return row ?? null
}

async function findByFrom(conn: Conn, shopId: string, fromPath: string) {
  const [row] = await conn
    .select()
    .from(schema.redirects)
    .where(and(eq(schema.redirects.shopId, shopId), eq(schema.redirects.fromPath, fromPath)))
  return row ?? null
}

export async function create(shopId: string, input: RedirectInput) {
  const { fromPath, toPath } = normalize(input)
  return db.transaction(async (tx) => {
    if (await findByFrom(tx, shopId, fromPath)) {
      throw new CatalogError('REDIRECT_TAKEN', `${fromPath} already redirects somewhere`)
    }
    const [row] = await tx.insert(schema.redirects).values({ shopId, fromPath, toPath }).returning()
    return row!
  })
}

export async function update(shopId: string, id: string, patch: Partial<RedirectInput>) {
  return db.transaction(async (tx) => {
    const existing = await getById(shopId, id, tx)
    if (!existing) return null
    const next = normalize({ fromPath: patch.fromPath ?? existing.fromPath, toPath: patch.toPath ?? existing.toPath })
    const taken = await findByFrom(tx, shopId, next.fromPath)
    if (taken && taken.id !== id) {
      throw new CatalogError('REDIRECT_TAKEN', `${next.fromPath} already redirects somewhere`)
    }
    const [row] = await tx
      .update(schema.redirects)
      .set(next)
      .where(and(eq(schema.redirects.shopId, shopId), eq(schema.redirects.id, id)))
      .returning()
    return row ?? null
  })
}

export async function remove(shopId: string, id: string) {
  const [row] = await db
    .delete(schema.redirects)
    .where(and(eq(schema.redirects.shopId, shopId), eq(schema.redirects.id, id)))
    .returning()
  return row ?? null
}

export async function removeMany(shopId: string, ids: string[]) {
  if (!ids.length) return 0
  const deleted = await db
    .delete(schema.redirects)
    .where(and(eq(schema.redirects.shopId, shopId), inArray(schema.redirects.id, ids)))
    .returning({ id: schema.redirects.id })
  return deleted.length
}

/** Where a storefront path goes, or null. A trailing slash does not matter. */
export async function resolve(shopId: string, path: string, conn: Conn = db) {
  const trimmed = path.replace(/\/+$/, '')
  if (!trimmed) return null
  return (await findByFrom(conn, shopId, trimmed))?.toPath ?? null
}

/**
 * A resource moved from one storefront path to another (its handle changed): the old path now redirects to the
 * new one. Keeps the table free of chains and loops: redirects that pointed at the old path are pointed at the
 * new one, and a redirect away from the new path is dropped (the page is live there again).
 */
export async function record(conn: Conn, shopId: string, fromPath: string, toPath: string) {
  if (fromPath === toPath) return
  await conn
    .delete(schema.redirects)
    .where(and(eq(schema.redirects.shopId, shopId), eq(schema.redirects.fromPath, toPath)))
  await conn
    .update(schema.redirects)
    .set({ toPath })
    .where(and(eq(schema.redirects.shopId, shopId), eq(schema.redirects.toPath, fromPath)))
  await conn
    .insert(schema.redirects)
    .values({ shopId, fromPath, toPath })
    .onConflictDoUpdate({ target: [schema.redirects.shopId, schema.redirects.fromPath], set: { toPath } })
}
