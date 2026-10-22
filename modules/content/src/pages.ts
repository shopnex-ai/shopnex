// Pages (admin: Online store → Pages): About, FAQ, Shipping policy… Business logic only; every query is
// scoped by shopId. Bodies are sanitized on write, since storefronts render them as is.
import { and, asc, eq, isNotNull, lte } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'
import { sanitizeHtml, slugify } from '@shopnex/catalog'
import { ContentError } from './errors'

export type PageInput = {
  title: string
  /** Generated from the title when omitted */
  handle?: string
  bodyHtml?: string
  seo?: { title?: string | null; description?: string | null }
  /** Visible on the storefront */
  published?: boolean
}

export async function list(shopId: string, conn: Conn = db) {
  return conn.select().from(schema.pages).where(eq(schema.pages.shopId, shopId)).orderBy(asc(schema.pages.createdAt))
}

export async function getById(shopId: string, id: string, conn: Conn = db) {
  const [row] = await conn
    .select()
    .from(schema.pages)
    .where(and(eq(schema.pages.shopId, shopId), eq(schema.pages.id, id)))
  return row ?? null
}

async function getByHandle(shopId: string, handle: string, conn: Conn = db) {
  const [row] = await conn
    .select()
    .from(schema.pages)
    .where(and(eq(schema.pages.shopId, shopId), eq(schema.pages.handle, handle)))
  return row ?? null
}

const visible = (shopId: string) =>
  and(eq(schema.pages.shopId, shopId), isNotNull(schema.pages.publishedAt), lte(schema.pages.publishedAt, new Date()))

/** For storefronts: null when there's no such page or it's hidden */
export async function getPublishedByHandle(shopId: string, handle: string, conn: Conn = db) {
  const [row] = await conn
    .select()
    .from(schema.pages)
    .where(and(visible(shopId), eq(schema.pages.handle, handle)))
  return row ?? null
}

export async function listPublished(shopId: string, opts: { limit: number; offset: number }, conn: Conn = db) {
  return conn
    .select()
    .from(schema.pages)
    .where(visible(shopId))
    .orderBy(asc(schema.pages.createdAt))
    .limit(opts.limit)
    .offset(opts.offset)
}

async function assertHandleFree(conn: Conn, shopId: string, handle: string, exceptId?: string) {
  const existing = await getByHandle(shopId, handle, conn)
  if (existing && existing.id !== exceptId) {
    throw new ContentError('HANDLE_TAKEN', `Handle "${handle}" is already used by another page`)
  }
}

// "about-us", then "about-us-2"…
async function freeHandle(conn: Conn, shopId: string, title: string) {
  const base = slugify(title, 'page')
  for (let n = 1; ; n++) {
    const handle = n === 1 ? base : `${base}-${n}`
    if (!(await getByHandle(shopId, handle, conn))) return handle
  }
}

const fields = (input: Partial<PageInput>) => ({
  ...(input.title !== undefined && { title: input.title }),
  ...(input.bodyHtml !== undefined && { bodyHtml: sanitizeHtml(input.bodyHtml) }),
  ...(input.seo?.title !== undefined && { seoTitle: input.seo.title }),
  ...(input.seo?.description !== undefined && { seoDescription: input.seo.description }),
})

export async function create(shopId: string, input: PageInput) {
  return db.transaction(async (tx) => {
    let handle = input.handle
    if (handle) await assertHandleFree(tx, shopId, handle)
    else handle = await freeHandle(tx, shopId, input.title)
    const [row] = await tx
      .insert(schema.pages)
      .values({
        shopId,
        handle,
        title: input.title,
        ...fields(input),
        publishedAt: input.published === false ? null : new Date(),
      })
      .returning()
    return row!
  })
}

// Returns null when the page isn't in this shop. Publishing keeps the first publish date.
export async function update(shopId: string, id: string, patch: Partial<PageInput>) {
  return db.transaction(async (tx) => {
    const current = await getById(shopId, id, tx)
    if (!current) return null
    if (patch.handle !== undefined) await assertHandleFree(tx, shopId, patch.handle, id)
    const publishedAt =
      patch.published === undefined ? current.publishedAt : patch.published ? (current.publishedAt ?? new Date()) : null
    const [row] = await tx
      .update(schema.pages)
      .set({
        ...fields(patch),
        ...(patch.handle !== undefined && { handle: patch.handle }),
        publishedAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.pages.id, id))
      .returning()
    return row!
  })
}

export async function remove(shopId: string, id: string) {
  const [row] = await db
    .delete(schema.pages)
    .where(and(eq(schema.pages.shopId, shopId), eq(schema.pages.id, id)))
    .returning()
  return row ?? null
}
