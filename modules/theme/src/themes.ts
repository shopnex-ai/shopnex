// Theme library storage (admin: Online store → Themes). Every query is scoped by shopId.
// Documents are validated by the API layer (ThemeDocument in @shopnex/storefront-sdk/theme); this module
// only stores them: the editor saves a copy's draft, publishing copies the draft to what storefronts see
// and makes that copy the shop's live theme (at most one). Storefronts render the live copy: one with
// several themes renders its theme (`getLive`), a single-theme storefront only when it's a copy of its own.
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'
import type { StoredThemeDocument } from '@shopnex/db/schema'

const t = schema.shopThemes

const byId = (shopId: string, id: string) => and(eq(t.shopId, shopId), eq(t.id, id))

const hasFiles = sql<boolean>`${t.files} <> '{}'::jsonb`

// Serializes the writes that decide which copy is live, so two requests can't both make one
const lockShop = (tx: Conn, shopId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`shop_themes:${shopId}`}))`)

/** The library without documents, live copy first */
export async function list(shopId: string, conn: Conn = db) {
  return conn
    .select({
      id: t.id,
      themeId: t.themeId,
      name: t.name,
      role: t.role,
      marketplaceThemeId: t.marketplaceThemeId,
      publishedAt: t.publishedAt,
      // jsonb equality ignores key order
      unpublishedChanges: sql<boolean>`${t.draft} is distinct from ${t.published}`,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })
    .from(t)
    .where(eq(t.shopId, shopId))
    .orderBy(sql`${t.role} = 'live' desc`, desc(t.updatedAt))
}

export async function get(shopId: string, id: string, conn: Conn = db) {
  const [row] = await conn.select().from(t).where(byId(shopId, id))
  return row ?? null
}

/** For storefronts: the live copy's theme and what it published (null until then). Null without themes. */
export async function getLive(shopId: string, conn: Conn = db) {
  const [row] = await conn
    .select({ id: t.id, themeId: t.themeId, published: t.published, filesVersion: t.filesVersion, hasFiles })
    .from(t)
    .where(and(eq(t.shopId, shopId), eq(t.role, 'live')))
  return row ?? null
}

type NewTheme = { themeId: string; name: string; draft: StoredThemeDocument; marketplaceThemeId?: string }

// The shop's first theme goes live right away (it shows the theme's defaults until published)
async function insert(tx: Conn, shopId: string, theme: NewTheme) {
  const [live] = await tx
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.shopId, shopId), eq(t.role, 'live')))
  const [row] = await tx
    .insert(t)
    .values({ shopId, ...theme, role: live ? 'unpublished' : 'live' })
    .returning()
  return row!
}

export async function create(shopId: string, theme: NewTheme, conn: Conn = db) {
  return conn.transaction(async (tx) => {
    await lockShop(tx, shopId)
    return insert(tx, shopId, theme)
  })
}

/**
 * Adds a copy of a theme when the shop has none: the storefront's default theme for a new shop (so it can
 * be customized right away), or a theme the merchant adds. Null when there already is one.
 */
export async function ensure(shopId: string, theme: NewTheme, conn: Conn = db) {
  return conn.transaction(async (tx) => {
    await lockShop(tx, shopId)
    const [existing] = await tx
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.shopId, shopId), eq(t.themeId, theme.themeId)))
      .limit(1)
    return existing ? null : insert(tx, shopId, theme)
  })
}

export async function saveDraft(shopId: string, id: string, draft: StoredThemeDocument, conn: Conn = db) {
  const [row] = await conn.update(t).set({ draft, updatedAt: new Date() }).where(byId(shopId, id)).returning()
  return row ?? null
}

// The copy's draft goes live, replacing the shop's live theme. Null when there's no such copy.
export async function publish(shopId: string, id: string, conn: Conn = db) {
  return conn.transaction(async (tx) => {
    await lockShop(tx, shopId)
    if (!(await get(shopId, id, tx))) return null
    await tx
      .update(t)
      .set({ role: 'unpublished', updatedAt: new Date() })
      .where(and(eq(t.shopId, shopId), eq(t.role, 'live'), ne(t.id, id)))
    const [row] = await tx
      .update(t)
      .set({ role: 'live', published: sql`${t.draft}`, publishedAt: new Date(), updatedAt: new Date() })
      .where(byId(shopId, id))
      .returning()
    return row!
  })
}

// Throws away unpublished changes (back to the published copy). Null when never published.
export async function discardDraft(shopId: string, id: string, conn: Conn = db) {
  const [row] = await conn
    .update(t)
    .set({ draft: sql`${t.published}`, updatedAt: new Date() })
    .where(and(byId(shopId, id), sql`${t.published} is not null`))
    .returning()
  return row ?? null
}

// An unpublished copy of the draft, to try changes without touching the live theme
export async function duplicate(shopId: string, id: string, name?: string, conn: Conn = db) {
  const source = await get(shopId, id, conn)
  if (!source) return null
  const [row] = await conn
    .insert(t)
    .values({
      shopId,
      themeId: source.themeId,
      name: name ?? `Copy of ${source.name}`,
      draft: source.draft,
      files: source.files,
    })
    .returning()
  return row!
}

// --- Code (Edit code): edited Liquid files, applied to the copy as soon as they're saved ---

/** Adds or replaces one file. Null when there's no such copy. */
export async function saveFile(shopId: string, id: string, path: string, source: string, conn: Conn = db) {
  const [row] = await conn
    .update(t)
    .set({
      files: sql`${t.files} || jsonb_build_object(${path}::text, ${source}::text)`,
      filesVersion: sql`${t.filesVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(byId(shopId, id))
    .returning({ filesVersion: t.filesVersion, updatedAt: t.updatedAt })
  return row ?? null
}

/** Back to the theme's own file (or a new snippet is gone). Null when there's no such copy. */
export async function deleteFile(shopId: string, id: string, path: string, conn: Conn = db) {
  const [row] = await conn
    .update(t)
    .set({
      files: sql`${t.files} - ${path}::text`,
      filesVersion: sql`${t.filesVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(byId(shopId, id))
    .returning({ filesVersion: t.filesVersion, updatedAt: t.updatedAt })
  return row ?? null
}

export async function rename(shopId: string, id: string, name: string, conn: Conn = db) {
  const [row] = await conn.update(t).set({ name, updatedAt: new Date() }).where(byId(shopId, id)).returning()
  return row ?? null
}

// The live theme can't be deleted (publish another one first). Null when there's no such unpublished copy.
export async function remove(shopId: string, id: string, conn: Conn = db) {
  const [row] = await conn
    .delete(t)
    .where(and(byId(shopId, id), ne(t.role, 'live')))
    .returning({ id: t.id })
  return row ?? null
}

// --- Theme Store (styles synced from the marketplace by @shopnex/apps; the same for every shop) ---

const store = schema.marketplaceThemes

/** The Theme Store's styles, without documents */
export async function listStore(conn: Conn = db) {
  return conn
    .select({
      id: store.id,
      name: store.name,
      tagline: store.tagline,
      description: store.description,
      developerName: store.developerName,
      baseThemeId: store.baseThemeId,
      screenshotUrl: store.screenshotUrl,
      listingUrl: store.listingUrl,
      updatedAt: store.updatedAt,
    })
    .from(store)
    .orderBy(store.name)
}

export async function getStoreTheme(id: string, conn: Conn = db) {
  const [row] = await conn.select().from(store).where(eq(store.id, id))
  return row ?? null
}
