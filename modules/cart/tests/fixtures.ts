import type { Conn } from '@shopnex/db'
// What the cart tests share: the embedded database, a product catalog on the Online Store, carts, and everything a checkout creates, cleaned up
// afterwards. Importing this file picks the database, so it must come before anything imports @shopnex/db.
import { shops } from '@shopnex/core/schema'
import { carrierServices, carts, shippingRates } from '../src/cart.schema'
import { orders } from '@shopnex/orders/schema'
import { customers } from '@shopnex/customers/schema'
import { products } from '@shopnex/catalog/schema'
import { channels } from '@shopnex/channels/schema'

process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET ??= 'cart-test-secret-0123456789-abcdefghij'
process.env.APP_URL = 'http://localhost:3000'
delete process.env.TENANCY_MODE

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
// These tests delete rows: never against a real database
requireEmbeddedDatabase()
const { eq, inArray } = await import('drizzle-orm')
const { channelService } = await import('@shopnex/channels')
const { productService } = await import('@shopnex/catalog')
const { discountService } = await import('@shopnex/pricing')
const { paymentMethodService } = await import('@shopnex/payments')
const { cartService } = await import('../src')

export { db, prepareDatabase, eq, cartService }
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
    .insert(channels)
    .values({ shopId: SHOP, handle: `quiet-${unique()}`, name: 'Quiet', autoPublish: false })
    .returning()
  made.channels.push(row!.id)
  return row!
}

/** A product with its variants; on the Online Store unless it is made in a shop without one */
export async function product(patch: Partial<Parameters<typeof productService.create>[1]> = {}, shopId = SHOP) {
  const price = patch.variants ? {} : { priceCents: 2500 }
  const created = await productService.create(shopId, { title: 'Linen shirt', ...price, ...patch } as never, db)
  return created
}

/** A cart on the Online Store with these lines */
export async function cart(lines: { variantId: string; quantity: number }[] = [], shopId = SHOP) {
  const channel = await onlineStore(shopId)
  return cartService.create(shopId, channel.id, db, lines)
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

export async function shippingRate(patch: Partial<typeof shippingRates.$inferInsert> = {}, shopId = SHOP) {
  const [row] = await db
    .insert(shippingRates)
    .values({ shopId, name: 'Standard', priceCents: 500, ...patch })
    .returning()
  return row!
}

export const trackApp = (id: string) => made.apps.push(id)

/** Everything the tests made, and the orders and customers a checkout caused */
export async function cleanup() {
  const shopIds = [SHOP, OTHER_SHOP]
  await db.delete(carts).where(inArray(carts.shopId, shopIds))
  await db.delete(orders).where(inArray(orders.shopId, shopIds))
  await db.delete(customers).where(inArray(customers.shopId, shopIds))
  await db.delete(shippingRates).where(inArray(shippingRates.shopId, shopIds))
  await db.delete(carrierServices).where(inArray(carrierServices.shopId, shopIds))
  const { taxRates } = await import('@shopnex/pricing/schema')
  await db.delete(taxRates).where(inArray(taxRates.shopId, shopIds))
  if (made.methods.length) {
    const { paymentMethods } = await import('@shopnex/payments/schema')
    await db.delete(paymentMethods).where(inArray(paymentMethods.id, made.methods))
  }
  if (made.discounts.length) await discountService.removeMany(SHOP, made.discounts, db)
  await db.delete(products).where(inArray(products.shopId, shopIds))
  const { apps } = await import('@shopnex/core/schema')
  if (made.apps.length) await db.delete(apps).where(inArray(apps.id, made.apps))
  if (made.channels.length) await db.delete(channels).where(inArray(channels.id, made.channels))
  for (const list of Object.values(made)) list.length = 0
}
