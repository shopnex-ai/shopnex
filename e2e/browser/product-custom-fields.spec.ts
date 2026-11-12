// Product page: custom fields are saved by the page's own Save bar together with the other fields, and
// Discard drops them too (they used to have a separate Save that the page's Save ignored).
import { expect, test } from './test'
import { eq } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { Fixtures, PASSWORD, call, ok, requireApp } from '../lib'

const fx = new Fixtures()
const run = Date.now().toString(36)
const label = `Material ${run}`
const key = `material_${run}`.slice(0, 40)
let productId = ''
let defId = ''
let token: Record<string, string>

test.beforeAll(async () => {
  await requireApp()
  await fx.init()
  const owner = await fx.account('owner')
  token = await fx.token(['write_products'])
  defId = ok(
    await call(
      'POST',
      '/admin/custom-fields',
      { resource: 'product', key, label, type: 'text', storefront: true },
      owner.headers,
    ),
  ).id
  productId = ok(
    await call(
      'POST',
      '/admin/products',
      { title: `E2E custom fields ${run}`, variants: [{ priceCents: 1000 }] },
      token,
    ),
  ).id
})

test.afterAll(async () => {
  if (productId) await db.delete(schema.products).where(eq(schema.products.id, productId))
  if (defId) {
    const owner = await fx.account('owner')
    await call('DELETE', `/admin/custom-fields/${defId}`, undefined, owner.headers)
  }
  await fx.cleanup()
})

const stored = async () => ok(await call('GET', `/admin/products/${productId}`, undefined, token))

test('the page Save saves custom fields with the title, and Discard drops them', async ({ page }) => {
  const owner = await fx.account('owner')
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(/\/admin(\/)?$/)
  await page.goto(`/admin/products/${productId}`)

  const field = page.getByLabel(label)
  const bar = page.getByText('Unsaved changes')
  await expect(field).toBeVisible()
  await expect(bar).toHaveCount(0)

  // A custom field alone makes the page's bar appear, and Discard clears it
  await field.fill('Linen')
  await expect(bar).toBeVisible()
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(field).toHaveValue('')
  await expect(bar).toHaveCount(0)

  // Title and custom field together: one Save stores both
  await page.getByLabel('Title', { exact: true }).fill(`E2E custom fields ${run} renamed`)
  await field.fill('Linen')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Product saved').last()).toBeVisible()
  await expect(bar).toHaveCount(0)
  await expect.poll(async () => (await stored()).title).toMatch(/renamed$/)
  await expect.poll(async () => (await stored()).customFields[key]).toBe('Linen')

  // Only a custom field changed: the page's Save stores it
  await field.fill('Wool')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Product saved').last()).toBeVisible()
  await expect.poll(async () => (await stored()).customFields[key]).toBe('Wool')

  // Cleared: null removes the value
  await field.fill('')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Product saved').last()).toBeVisible()
  await expect.poll(async () => (await stored()).customFields[key]).toBeUndefined()
})
