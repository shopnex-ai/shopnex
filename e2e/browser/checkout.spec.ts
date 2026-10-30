// A shopper buys through the bundled storefront and the hosted checkout, then the shop owner finds the order in
// the admin. Drives the real pages; setup (payment method, shipping rate, owner account) goes through Fixtures.
import { expect, test } from '@playwright/test'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { Fixtures, PASSWORD, SHOP, requireApp } from '../lib'

const STOREFRONT_URL = (process.env.STOREFRONT_URL ?? 'http://localhost:4321').replace(/\/$/, '')

const fx = new Fixtures()
let slug: string
let owner: Awaited<ReturnType<Fixtures['account']>>

// A product whose variants can all be bought, so whichever the theme preselects works
async function buyableProductSlug() {
  const rows = await db
    .select({ slug: schema.products.slug, stock: schema.productVariants.inventoryQuantity })
    .from(schema.products)
    .innerJoin(schema.productVariants, eq(schema.productVariants.productId, schema.products.id))
    .where(and(eq(schema.products.shopId, SHOP), eq(schema.products.status, 'active')))
  const slugs = [...new Set(rows.map((r) => r.slug))]
  const found = slugs.find((s) => rows.filter((r) => r.slug === s).every((r) => r.stock === null || r.stock >= 10))
  if (!found) throw new Error('Need an active product with all variants in stock')
  return found
}

test.beforeAll(async () => {
  await requireApp()
  await fx.init()
  await fx.paymentMethod('E2E bank transfer')
  await fx.shippingRate(500)
  owner = await fx.account('owner')
  slug = await buyableProductSlug()
})

test.afterAll(async () => {
  // The order was placed through the browser, so Fixtures doesn't know it yet
  const placed = await db.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.email, fx.email))
  for (const { id } of placed) fx.order(id)
  await fx.cleanup()
})

// Known issue 2 (browser/KNOWN_ISSUES.md): a fully filled checkout form is rejected
test.fixme('a shopper checks out and the owner sees the order in the admin', async ({ page }) => {
  // Storefront: product → cart drawer → hosted checkout
  await page.goto(`${STOREFRONT_URL}/products/${slug}`)
  await page.getByRole('button', { name: /add to cart/i }).click()
  await page
    .getByRole('link', { name: /proceed to checkout/i })
    .or(page.getByRole('button', { name: /proceed to checkout/i }))
    .click()
  await page.waitForURL(/\/checkout\//)

  await page.getByLabel('Email').fill(fx.email)
  await page.getByLabel('Country / region').selectOption('US')
  await page.getByLabel('Last name').fill('Tester')
  await page.getByLabel('Address', { exact: true }).fill('1 Main St')
  await page.getByLabel('City').fill('Somewhere')
  await page.getByLabel('Postal code').fill('10001')
  await page.getByLabel('State / region').fill('NY')
  // Shipping methods appear once the address is in
  const shipping = page.locator('input[name="shippingRateId"]').first()
  await expect(shipping).toBeVisible()
  await shipping.check()
  await page.getByLabel('E2E bank transfer').check()

  await page.getByRole('button', { name: /place order/i }).click()
  await expect(page.getByText(/Transfer the total to IBAN E2E-0000/)).toBeVisible()
  const orderNumber = (
    await page
      .getByText(/#\d{4,}/)
      .first()
      .innerText()
  ).match(/#\d{4,}/)![0]

  // Admin: sign in as the owner and find the order
  await page.context().clearCookies()
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(/\/admin(\/)?$/)
  await page.goto('/admin/orders')
  await expect(page.getByText(orderNumber).first()).toBeVisible()
})
