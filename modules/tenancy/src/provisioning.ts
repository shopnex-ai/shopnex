import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { channelService } from '@shopnex/channels'
import { db, schema, type Conn } from '@shopnex/db'

const DEFAULT_CURRENCY = 'USD'

// A shop's slug is its subdomain and never changes, so it is a random handle ("shop-4f2a9c1e"), not made from the name
// the owner may change. A clash is not expected; the unique index still decides if two sign-ups race.
async function randomSlug(conn: Pick<typeof db, 'select'>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = `shop-${randomUUID().replaceAll('-', '').slice(0, 8)}`
    const [taken] = await conn.select({ id: schema.shops.id }).from(schema.shops).where(eq(schema.shops.slug, slug))
    if (!taken) return slug
  }
  return `shop-${randomUUID().replaceAll('-', '').slice(0, 16)}`
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
      .values({ id, name, slug: await randomSlug(tx), currency: input.currency ?? DEFAULT_CURRENCY })
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
