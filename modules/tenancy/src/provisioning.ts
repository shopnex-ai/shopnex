import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { channelService } from '@shopnex/channels'
import { seedDefaultMenu } from '@shopnex/content'
import { db, type Conn } from '@shopnex/db'
import { shopMembers } from './tenancy.schema'
import { shops } from '@shopnex/core/schema'

const DEFAULT_CURRENCY = 'USD'

// Named like the single-store shop until the owner names it in /admin/welcome
export const NEW_SHOP_NAME = 'My Shop'

// A shop's slug is its subdomain and never changes, so it is a random handle ("shop-4f2a9c1e"), not made from the name
// the owner may change. A clash is not expected; the unique index still decides if two sign-ups race.
async function randomSlug(conn: Pick<typeof db, 'select'>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = `shop-${randomUUID().replaceAll('-', '').slice(0, 8)}`
    const [taken] = await conn.select({ id: shops.id }).from(shops).where(eq(shops.slug, slug))
    if (!taken) return slug
  }
  return `shop-${randomUUID().replaceAll('-', '').slice(0, 16)}`
}

/**
 * A new shop for `ownerId`: the owner membership, and the default menus (content's). Shipping rates and payment methods are real
 * settings the owner chooses (the Home checklist points to them), so none are made up here. The Online Store channel
 * is created here too, so products added right away are published on it; the first theme is created on first use.
 */
export async function createShop(input: { ownerId: string; name: string; currency?: string }) {
  const name = input.name.trim()
  return db.transaction(async (tx) => {
    const id = randomUUID()
    const [shop] = await tx
      .insert(shops)
      .values({ id, name, slug: await randomSlug(tx), currency: input.currency ?? DEFAULT_CURRENCY })
      .returning()
    await tx.insert(shopMembers).values({ id: randomUUID(), organizationId: id, userId: input.ownerId, role: 'owner' })
    await seedDefaultMenu(tx, id)
    // Make the Online Store now: it's otherwise created on first use, after the first products are added,
    // and a product is only auto-published on channels that already exist
    await channelService.getDefault(id, tx)
    return shop!
  })
}
