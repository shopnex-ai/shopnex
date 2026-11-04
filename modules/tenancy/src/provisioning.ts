import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { channelService } from '@shopnex/channels'
import { db, schema, type Conn } from '@shopnex/db'
import { RESERVED_SLUGS } from './subdomains'

const DEFAULT_CURRENCY = 'USD'

const baseSlug = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'shop'

// "acme", then "acme-4f2a"… until it's free; a name the platform keeps ("admin") is never free as is
// (the unique index still decides if two signups race)
async function uniqueSlug(conn: Pick<typeof db, 'select'>, name: string) {
  const base = baseSlug(name)
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomUUID().slice(0, 4)}`
    if (attempt === 0 && RESERVED_SLUGS.has(slug)) continue
    const [taken] = await conn.select({ id: schema.shops.id }).from(schema.shops).where(eq(schema.shops.slug, slug))
    if (!taken) return slug
  }
  return `${base}-${randomUUID().slice(0, 8)}`
}

/**
 * The storefront's menus, so a new shop has working navigation from the first visit: the header (`main-menu`)
 * and the footer (`footer`), the two handles every bundled theme reads. Every link needs no content (the front
 * page, the catalog, search), so the menus are valid before there is a product or collection.
 * Never replaces an existing menu: a merchant who deleted or rebuilt theirs keeps it that way.
 */
export async function seedDefaultMenu(conn: Conn, shopId: string) {
  await conn
    .insert(schema.menus)
    .values([
      {
        shopId,
        handle: 'main-menu',
        title: 'Main menu',
        items: [
          { id: randomUUID(), title: 'Home', type: 'frontpage', items: [] },
          { id: randomUUID(), title: 'Shop all', type: 'catalog', items: [] },
        ],
      },
      {
        shopId,
        handle: 'footer',
        title: 'Footer menu',
        items: [{ id: randomUUID(), title: 'Search', type: 'search', items: [] }],
      },
    ])
    .onConflictDoNothing()
}

/**
 * A new shop for `ownerId`: the owner membership and a main menu. Shipping rates and payment methods are real
 * settings the owner chooses (the Home checklist points to them), so none are made up here. The Online Store channel
 * is created here too, so products added right away are published on it; the first theme is created on first use.
 */
export async function createShop(input: { ownerId: string; name: string; currency?: string }) {
  const name = input.name.trim()
  return db.transaction(async (tx) => {
    const id = randomUUID()
    const [shop] = await tx
      .insert(schema.shops)
      .values({ id, name, slug: await uniqueSlug(tx, name), currency: input.currency ?? DEFAULT_CURRENCY })
      .returning()
    await tx
      .insert(schema.shopMembers)
      .values({ id: randomUUID(), organizationId: id, userId: input.ownerId, role: 'owner' })
    await seedDefaultMenu(tx, id)
    // Make the Online Store now: it's otherwise created on first use, after the sample products are added,
    // and a product is only auto-published on channels that already exist
    await channelService.getDefault(id, tx)
    return shop!
  })
}
