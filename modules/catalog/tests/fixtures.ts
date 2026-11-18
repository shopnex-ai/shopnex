import { shops as shopsTable } from '@shopnex/core/schema'
// What the catalog tests share: the embedded database and a few rows. Importing this file picks the database, so it must come
// before anything imports @shopnex/db.
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, schema, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
requireEmbeddedDatabase()
const { eq, inArray } = await import('drizzle-orm')
const { productService, collectionService, variantService, CatalogError } = await import('../src')
const { webhookDeliveries, webhookEndpoints } = await import('@shopnex/webhooks/schema')

export { db, schema, prepareDatabase, eq, productService, collectionService, variantService, CatalogError }
export const SHOP = 'default'
export const OTHER_SHOP = 'catalog-other-shop'

let counter = 0
export const unique = () => `${Date.now().toString(36)}${(++counter).toString(36)}`
const madeChannels: string[] = []

export async function otherShop() {
  await db
    .insert(shopsTable)
    .values({ id: OTHER_SHOP, name: 'Other shop', slug: `other-${unique()}` })
    .onConflictDoNothing()
}

/** A channel made directly; `autoPublish` is what makes new products and collections land on it */
export async function channel(patch: Partial<typeof schema.channels.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.channels)
    .values({ shopId: SHOP, handle: `ch-${unique()}`, name: 'Test channel', autoPublish: false, ...patch })
    .returning()
  madeChannels.push(row!.id)
  return row!
}

/** A webhook endpoint subscribed to these topics; its deliveries are what the tests read */
export async function endpoint(topics: string[]) {
  const [row] = await db
    .insert(webhookEndpoints)
    .values({
      shopId: SHOP,
      url: 'https://example.com/hook',
      topics: topics as never,
      secret: 'whsec_test',
    })
    .returning()
  return row!
}

export async function deliveries(endpointId: string) {
  const rows = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, endpointId))
  return rows.map((d) => ({ topic: d.topic, data: (JSON.parse(d.body) as { data: Record<string, unknown> }).data }))
}

/** Everything the tests made. Products and collections go first (their images, options, variants and links cascade). */
export async function cleanup() {
  const shops = [SHOP, OTHER_SHOP]
  await db.delete(schema.products).where(inArray(schema.products.shopId, shops))
  await db.delete(schema.collections).where(inArray(schema.collections.shopId, shops))
  await db.delete(webhookEndpoints).where(inArray(webhookEndpoints.shopId, shops))
  if (madeChannels.length) await db.delete(schema.channels).where(inArray(schema.channels.id, madeChannels))
  madeChannels.length = 0
}
