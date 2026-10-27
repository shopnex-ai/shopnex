// Theme library storage (admin: Online store → Themes). Every query is scoped by shopId.
// Documents are validated by the API layer (ThemeDocument in @shopnex/storefront-sdk/theme); this module
// only stores them: the editor saves a copy's draft, publishing copies the draft to what storefronts see
// and makes that copy the shop's live theme (at most one). Code edits (Edit code) have their own draft and
// publish, apart from the document's (see "Code" below). Storefronts render the live copy: one with
// several themes renders its theme (`getLive`), a single-theme storefront only when it's a copy of its own.
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'
import { applyChanges, draftJoin, draftService, hasDraft } from '@shopnex/drafts'
import type { ShopTheme, StoredThemeDocument } from '@shopnex/db/schema'

const t = schema.shopThemes

/** The entity type of a copy's code draft (entity_drafts) */
export const CODE_DRAFT = 'theme_code'

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
      unpublishedChanges: sql<boolean>`${t.draft} is distinct from ${t.published} or ${hasDraft}`,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })
    .from(t)
    .leftJoin(schema.entityDrafts, draftJoin(CODE_DRAFT, t.shopId, t.id))
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
  await draftService.copy(shopId, CODE_DRAFT, id, row!.id, conn)
  return row!
}

// --- Code (Edit code): the copy's Liquid files. Edits go to a draft (autosaved, read by the preview);
// publishing them writes `files`, which buyers get when the copy is live. Apart from the document's draft. ---

/** The files as the preview shows them: the copy's, with the draft over them */
export async function codeDraft(shopId: string, copy: Pick<ShopTheme, 'id' | 'files' | 'filesVersion'>, conn: Conn = db) {
  const { changes, rev } = await draftService.get(shopId, CODE_DRAFT, copy.id, conn)
  return {
    files: applyChanges(copy.files, changes),
    changed: Object.keys(changes),
    rev,
    // Bumps on every save and publish of either, so storefronts can tell versions of the preview apart
    version: copy.filesVersion + rev,
  }
}

/** Adds or replaces one file in the draft; a null source puts the theme's own file back (or removes a snippet). Null when there's no such copy. */
export async function saveFile(shopId: string, id: string, path: string, source: string | null, conn: Conn = db) {
  if (!(await get(shopId, id, conn))) return null
  return { rev: await draftService.patch(shopId, CODE_DRAFT, id, { [path]: source }, conn) }
}

/** Writes the draft to the copy's files. `published` is false when there was nothing to publish. Null when there's no such copy. */
export async function publishCode(shopId: string, id: string, expectedRev?: number, conn: Conn = db) {
  if (!(await get(shopId, id, conn))) return null
  return draftService.publish(
    shopId,
    CODE_DRAFT,
    id,
    async (tx, changes) => {
      const [row] = await tx.select({ files: t.files }).from(t).where(byId(shopId, id)).for('update')
      await tx
        .update(t)
        .set({
          files: applyChanges(row!.files, changes),
          filesVersion: sql`${t.filesVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(byId(shopId, id))
    },
    { expectedRev },
    conn,
  )
}

/** Back to the published files. Null when there's no such copy. */
export async function discardCode(shopId: string, id: string, conn: Conn = db) {
  if (!(await get(shopId, id, conn))) return null
  return { rev: await draftService.discard(shopId, CODE_DRAFT, id, conn) }
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
  if (row) await draftService.remove(shopId, CODE_DRAFT, id, conn)
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
