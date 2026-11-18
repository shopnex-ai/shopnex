// What the orders tests share: the embedded database, products with variants to sell, customers, discounts, tax rates, a webhook endpoint to
// read what was sent, and the cleanup of everything an order causes. Importing this file picks the database, so it must come before anything
// imports @shopnex/db.
import { shops } from '@shopnex/core/schema'

process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'
delete process.env.TENANCY_MODE

const { db, schema, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
// These tests delete rows: never against a real database
requireEmbeddedDatabase()
const { eq, inArray } = await import('drizzle-orm')
const { productService } = await import('@shopnex/catalog')
const { channelService } = await import('@shopnex/channels')
const { discountService, taxService } = await import('@shopnex/pricing')
const { webhookDeliveries, webhookEndpoints } = await import('@shopnex/webhooks/schema')
const { orderService } = await import('../src')
const { customerService } = await import('@shopnex/customers')

export { db, schema, prepareDatabase, eq, orderService, customerService }
export const SHOP = 'default'
export const OTHER_SHOP = 'orders-other-shop'

let counter = 0
export const unique = () => `${Date.now().toString(36)}${(++counter).toString(36)}`
const made = { discounts: [] as string[], channels: [] as string[] }

export async function otherShop() {
  await db.insert(shops).values({ id: OTHER_SHOP, name: 'Other', slug: OTHER_SHOP }).onConflictDoNothing()
}

export const onlineStore = (shopId = SHOP) => channelService.resolve(shopId, undefined, db)

export async function quietChannel() {
  const [row] = await db
    .insert(schema.channels)
    .values({ shopId: SHOP, handle: `quiet-${unique()}`, name: 'Quiet', autoPublish: false })
    .returning()
  made.channels.push(row!.id)
  return row!
}

/** A product with its variants */
export async function product(patch: Partial<Parameters<typeof productService.create>[1]> = {}, shopId = SHOP) {
  const price = patch.variants ? {} : { priceCents: 2500 }
  return productService.create(shopId, { title: 'Linen shirt', ...price, ...patch } as never)
}

export async function customer(patch: Partial<Parameters<typeof customerService.create>[1]> = {}, shopId = SHOP) {
  return (await customerService.create(shopId, { email: `c-${unique()}@example.test`, name: 'Ada Buyer', ...patch }))!
}

export async function discount(patch: Partial<Parameters<typeof discountService.create>[1]> = {}) {
  const row = await discountService.create(
    SHOP,
    {
      code: `CODE${unique()}`.toUpperCase(),
      type: 'percentage',
      value: 10,
      minSubtotalCents: null,
      usageLimit: null,
      oncePerCustomer: false,
      active: true,
      startsAt: null,
      endsAt: null,
      ...patch,
    },
    db,
  )
  made.discounts.push(row.id)
  return row
}

export const taxRate = (patch: Partial<Parameters<typeof taxService.create>[1]> = {}) =>
  taxService.create(SHOP, { countryCode: 'FR', province: null, name: 'VAT', ratePercent: 20, ...patch }, db)

export const address = {
  firstName: 'Ada',
  lastName: 'Buyer',
  company: null,
  address1: '1 Main St',
  address2: null,
  city: 'Paris',
  province: null,
  countryCode: 'FR',
  zip: '75001',
  phone: '+33100000000',
}

/** A webhook endpoint for these topics; call the result to read what it was sent */
export async function hook(topics: string[]) {
  const [row] = await db
    .insert(webhookEndpoints)
    .values({ shopId: SHOP, url: 'https://example.com/hook', topics: topics as never, secret: 'whsec_x' })
    .returning()
  return async () =>
    (await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, row!.id))).map((d) => ({
      topic: d.topic,
      data: (JSON.parse(d.body) as { data: Record<string, unknown> }).data,
    }))
}

/** Places an order for one product line, the usual way */
export async function place(patch: Partial<Parameters<typeof orderService.create>[1]> = {}, quantity = 1) {
  const p = await product()
  return orderService.create(SHOP, {
    email: `buyer-${unique()}@example.test`,
    items: [{ variantId: p.variants[0]!.id, quantity }],
    ...patch,
  })
}

export async function cleanup() {
  const shopIds = [SHOP, OTHER_SHOP]
  await db.delete(webhookEndpoints).where(inArray(webhookEndpoints.shopId, shopIds))
  await db.delete(schema.orders).where(inArray(schema.orders.shopId, shopIds))
  await db.delete(schema.customers).where(inArray(schema.customers.shopId, shopIds))
  const { taxRates } = await import('@shopnex/pricing/schema')
  await db.delete(taxRates).where(inArray(taxRates.shopId, shopIds))
  if (made.discounts.length) await discountService.removeMany(SHOP, made.discounts, db)
  await db.delete(schema.products).where(inArray(schema.products.shopId, shopIds))
  if (made.channels.length) await db.delete(schema.channels).where(inArray(schema.channels.id, made.channels))
  await db
    .update(shops)
    .set({ nextOrderNumber: 1001, currency: 'USD', taxesIncluded: false, taxShipping: false })
    .where(inArray(shops.id, shopIds))
  const { customFieldDefinitions } = await import('@shopnex/custom-fields/schema')
  await db.delete(customFieldDefinitions).where(inArray(customFieldDefinitions.shopId, shopIds))
  for (const list of Object.values(made)) list.length = 0
}
