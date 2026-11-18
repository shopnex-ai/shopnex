// What the storefront route tests share: the embedded database, the real router, and a shop with a catalog, content, a theme, carts and
// customers to read through the public API. Importing this file picks the database, so it must come before anything imports @shopnex/db.
import { call } from '@orpc/server'

process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'
process.env.APP_URL = 'http://localhost:3000'
delete process.env.TENANCY_MODE

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
// These tests delete rows: never against a real database
requireEmbeddedDatabase()
const { eq, inArray } = await import('drizzle-orm')
const { router } = await import('../src/router')
const { productService, collectionService } = await import('@shopnex/catalog')
const { channelService, storefrontKeyService } = await import('@shopnex/channels')
const { pageService, menuService } = await import('@shopnex/content')
const { cartService } = await import('@shopnex/cart')
const { customerService, accountService } = await import('@shopnex/customers')
const { orderService } = await import('@shopnex/orders')
const { themeService, createPreviewToken } = await import('@shopnex/theme')
const { discountService } = await import('@shopnex/pricing')
const { paymentMethodService } = await import('@shopnex/payments')
const { customFieldService } = await import('@shopnex/custom-fields')
const { PUBLISHABLE_KEY_HEADER } = await import('@shopnex/tenancy')
const { CUSTOMER_TOKEN_HEADER } = await import('@shopnex/storefront-sdk/constants')
const schemas = {
  carts: (await import('@shopnex/cart/schema')).carts,
  shippingRates: (await import('@shopnex/cart/schema')).shippingRates,
  orders: (await import('@shopnex/orders/schema')).orders,
  customers: (await import('@shopnex/customers/schema')).customers,
  products: (await import('@shopnex/catalog/schema')).products,
  collections: (await import('@shopnex/catalog/schema')).collections,
  pages: (await import('@shopnex/content/schema')).pages,
  menus: (await import('@shopnex/content/schema')).menus,
  channels: (await import('@shopnex/channels/schema')).channels,
  storefrontKeys: (await import('@shopnex/channels/schema')).storefrontKeys,
  shopThemes: (await import('@shopnex/theme/schema')).shopThemes,
  paymentMethods: (await import('@shopnex/payments/schema')).paymentMethods,
  customFieldDefinitions: (await import('@shopnex/custom-fields/schema')).customFieldDefinitions,
  emailSettings: (await import('@shopnex/email/schema')).emailSettings,
}
const { shops } = await import('@shopnex/core/schema')

export { db, prepareDatabase, eq, router, productService, collectionService, channelService, storefrontKeyService }
export { pageService, menuService, cartService, customerService, accountService, orderService, themeService }
export { createPreviewToken, discountService, paymentMethodService, customFieldService, schemas, shops }
export const SHOP = 'default'
export const OTHER_SHOP = 'storefront-other-shop'
export const sf = router.storefront as unknown as Record<string, Record<string, unknown>>
export { PUBLISHABLE_KEY_HEADER, CUSTOMER_TOKEN_HEADER }

let counter = 0
export const unique = () => `${Date.now().toString(36)}${(++counter).toString(36)}`
export const MISSING = '00000000-0000-4000-8000-000000000000'

/** Calls a public procedure the way the HTTP layer does: through the real router, with the request's headers */
export const run = <T = unknown>(procedure: unknown, input?: unknown, headers: Record<string, string> = {}) =>
  call(procedure as Parameters<typeof call>[0], input, {
    context: { headers: new Headers(headers) },
  } as never) as Promise<T>

export async function setup() {
  await prepareDatabase()
  await db.insert(shops).values({ id: OTHER_SHOP, name: 'Other', slug: OTHER_SHOP }).onConflictDoNothing()
  // The Online Store exists from the start, so what is created next is published on it
  await channelService.getDefault(SHOP, db)
}

export const onlineStore = () => channelService.getDefault(SHOP, db)

/** A channel that nothing is published on automatically, with a publishable key for it */
export async function quietChannel() {
  const [channel] = await db
    .insert(schemas.channels)
    .values({ shopId: SHOP, handle: `quiet-${unique()}`, name: 'Quiet', autoPublish: false })
    .returning()
  const key = await storefrontKeyService.create(SHOP, 'Quiet key', channel!.id, db)
  return { channel: channel!, key: key.token }
}

export const product = (patch: Partial<Parameters<typeof productService.create>[1]> = {}, shopId = SHOP) =>
  productService.create(shopId, {
    title: `Tee ${unique()}`,
    ...(patch.variants ? {} : { priceCents: 2500 }),
    ...patch,
  } as never)

export async function customerWithToken(email = `shopper-${unique()}@example.test`) {
  let code = ''
  await accountService.requestLoginCode(SHOP, email, (_to, c) => {
    code = c
    return Promise.resolve()
  })
  const { token, customer } = await accountService.verifyLoginCode(SHOP, email, code)
  return { token, customer, headers: { [CUSTOMER_TOKEN_HEADER]: token } }
}

export async function cleanup() {
  const shopIds = [SHOP, OTHER_SHOP]
  await db.delete(schemas.carts).where(inArray(schemas.carts.shopId, shopIds))
  await db.delete(schemas.orders).where(inArray(schemas.orders.shopId, shopIds))
  await db.delete(schemas.customers).where(inArray(schemas.customers.shopId, shopIds))
  await db.delete(schemas.shippingRates).where(inArray(schemas.shippingRates.shopId, shopIds))
  await db.delete(schemas.paymentMethods).where(inArray(schemas.paymentMethods.shopId, shopIds))
  await db.delete(schemas.products).where(inArray(schemas.products.shopId, shopIds))
  await db.delete(schemas.collections).where(inArray(schemas.collections.shopId, shopIds))
  await db.delete(schemas.pages).where(inArray(schemas.pages.shopId, shopIds))
  await db.delete(schemas.menus).where(inArray(schemas.menus.shopId, shopIds))
  await db.delete(schemas.shopThemes).where(inArray(schemas.shopThemes.shopId, shopIds))
  await db.delete(schemas.customFieldDefinitions).where(inArray(schemas.customFieldDefinitions.shopId, shopIds))
  await db.delete(schemas.emailSettings).where(inArray(schemas.emailSettings.shopId, shopIds))
  const quiet = (await db.select().from(schemas.channels).where(eq(schemas.channels.shopId, SHOP))).filter((c) =>
    c.handle.startsWith('quiet-'),
  )
  if (quiet.length) {
    const ids = quiet.map((c) => c.id)
    await db.delete(schemas.storefrontKeys).where(inArray(schemas.storefrontKeys.channelId, ids))
    await db.delete(schemas.channels).where(inArray(schemas.channels.id, ids))
  }
  for (const d of await discountService.list(SHOP, db)) await discountService.remove(SHOP, d.id, db)
  await db
    .update(shops)
    .set({ currency: 'USD', name: 'ShopNex', seoTitle: null, seoDescription: null, nextOrderNumber: 1001 })
    .where(eq(shops.id, SHOP))
    .catch(() => undefined)
}
