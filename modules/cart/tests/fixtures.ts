// What the cart tests share: the embedded database, a product catalog on the Online Store, carts, and everything a checkout creates, cleaned up
// afterwards. Importing this file picks the database, so it must come before anything imports @shopnex/db.
import { shops } from '@shopnex/core/schema'

process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET ??= 'cart-test-secret-0123456789-abcdefghij'
process.env.APP_URL = 'http://localhost:3000'
delete process.env.TENANCY_MODE

const { db, schema, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
// These tests delete rows: never against a real database
requireEmbeddedDatabase()
const { eq, inArray } = await import('drizzle-orm')
const { channelService } = await import('@shopnex/channels')
const { productService } = await import('@shopnex/catalog')
const { discountService } = await import('@shopnex/pricing')
const { paymentMethodService } = await import('@shopnex/payments')
const { cartService } = await import('../src')

export { db, schema, prepareDatabase, eq, cartService }
export const SHOP = 'default'
export const OTHER_SHOP = 'cart-other-shop'

let counter = 0
export const unique = () => `${Date.now().toString(36)}${(++counter).toString(36)}`
const made = { apps: [] as string[], discounts: [] as string[], methods: [] as string[], channels: [] as string[] }

export async function otherShop() {
  await db.insert(shops).values({ id: OTHER_SHOP, name: 'Other', slug: OTHER_SHOP }).onConflictDoNothing()
}

export const onlineStore = (shopId = SHOP) => channelService.resolve(shopId, undefined, db)

/** A channel that new products are not put on */
export async function quietChannel() {
  const [row] = await db
    .insert(schema.channels)
    .values({ shopId: SHOP, handle: `quiet-${unique()}`, name: 'Quiet', autoPublish: false })
    .returning()
  made.channels.push(row!.id)
  return row!
}

/** A product with its variants; on the Online Store unless it is made in a shop without one */
export async function product(patch: Partial<Parameters<typeof productService.create>[1]> = {}, shopId = SHOP) {
  const price = patch.variants ? {} : { priceCents: 2500 }
  const created = await productService.create(shopId, { title: 'Linen shirt', ...price, ...patch } as never)
  return created
}

/** A cart on the Online Store with these lines */
export async function cart(lines: { variantId: string; quantity: number }[] = [], shopId = SHOP) {
  const channel = await onlineStore(shopId)
  return cartService.create(shopId, channel.id, lines)
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

export async function manualMethod(name = 'Bank transfer') {
  const row = await paymentMethodService.create(
    SHOP,
    { name, active: true, additionalDetails: null, instructions: 'Pay by transfer' },
    db,
  )
  made.methods.push(row.id)
  return row
}

export async function shippingRate(patch: Partial<typeof schema.shippingRates.$inferInsert> = {}, shopId = SHOP) {
  const [row] = await db
    .insert(schema.shippingRates)
    .values({ shopId, name: 'Standard', priceCents: 500, ...patch })
    .returning()
  return row!
}

export const trackApp = (id: string) => made.apps.push(id)

/** Everything the tests made, and the orders and customers a checkout caused */
export async function cleanup() {
  const shopIds = [SHOP, OTHER_SHOP]
  await db.delete(schema.carts).where(inArray(schema.carts.shopId, shopIds))
  await db.delete(schema.orders).where(inArray(schema.orders.shopId, shopIds))
  await db.delete(schema.customers).where(inArray(schema.customers.shopId, shopIds))
  await db.delete(schema.shippingRates).where(inArray(schema.shippingRates.shopId, shopIds))
  await db.delete(schema.carrierServices).where(inArray(schema.carrierServices.shopId, shopIds))
  const { taxRates } = await import('@shopnex/pricing/schema')
  await db.delete(taxRates).where(inArray(taxRates.shopId, shopIds))
  if (made.methods.length) {
    const { paymentMethods } = await import('@shopnex/payments/schema')
    await db.delete(paymentMethods).where(inArray(paymentMethods.id, made.methods))
  }
  if (made.discounts.length) await discountService.removeMany(SHOP, made.discounts, db)
  await db.delete(schema.products).where(inArray(schema.products.shopId, shopIds))
  const { apps } = await import('@shopnex/core/schema')
  if (made.apps.length) await db.delete(apps).where(inArray(apps.id, made.apps))
  if (made.channels.length) await db.delete(schema.channels).where(inArray(schema.channels.id, made.channels))
  for (const list of Object.values(made)) list.length = 0
}
