import { shops } from '@shopnex/core/schema'
// What the channels tests share: the embedded database and a few rows. Importing this file picks the database, so it must come
// before anything imports @shopnex/db.
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, schema, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
const { resourcePublications, storefrontKeys } = await import('../src/channels.schema')
requireEmbeddedDatabase()
const { eq, inArray, sql } = await import('drizzle-orm')

export { db, schema, prepareDatabase }
export const SHOP = 'default'
export const OTHER_SHOP = 'channels-other-shop'

let counter = 0
const unique = () => `${Date.now().toString(36)}${(++counter).toString(36)}`
const made = { channels: [] as string[], products: [] as string[] }

export async function otherShop() {
  await db
    .insert(shops)
    .values({ id: OTHER_SHOP, name: 'Other shop', slug: `other-${unique()}` })
    .onConflictDoNothing()
}

/** A channel made directly (the service creates the default one itself) */
export async function channel(patch: Partial<typeof schema.channels.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.channels)
    .values({ shopId: SHOP, handle: `ch-${unique()}`, name: 'Test channel', ...patch })
    .returning()
  made.channels.push(row!.id)
  return row!
}

export async function product() {
  const [row] = await db
    .insert(schema.products)
    .values({ shopId: SHOP, slug: `p-${unique()}`, title: 'Linen shirt', priceCents: 2500 })
    .returning()
  made.products.push(row!.id)
  return row!
}

let orderNumber = 900_000
// An order, by table name: channels sits below orders and cannot import their table, not even in a test
export const orderOn = async (channelId: string) =>
  db.execute(
    sql`insert into orders (shop_id, order_number, channel_id, email, subtotal_cents, total_cents)
        values (${SHOP}, ${++orderNumber}, ${channelId}, 'buyer@example.com', 1000, 1000)`,
  )

export const storefrontKey = async (channelId: string, revoked = false) =>
  db.insert(storefrontKeys).values({
    id: crypto.randomUUID(),
    shopId: SHOP,
    name: 'Key',
    channelId,
    token: `pk_${unique()}`,
    ...(revoked ? { revokedAt: new Date() } : {}),
  })

/** Everything the tests made, and the default channel and publications they caused */
export async function cleanup() {
  await db.execute(sql`delete from orders where shop_id in (${SHOP}, ${OTHER_SHOP})`)
  await db.delete(resourcePublications).where(inArray(resourcePublications.shopId, [SHOP, OTHER_SHOP]))
  await db.delete(storefrontKeys).where(inArray(storefrontKeys.shopId, [SHOP, OTHER_SHOP]))
  if (made.products.length) await db.delete(schema.products).where(inArray(schema.products.id, made.products))
  await db.delete(schema.channels).where(inArray(schema.channels.shopId, [SHOP, OTHER_SHOP]))
  made.channels.length = 0
  made.products.length = 0
}
export { eq }
