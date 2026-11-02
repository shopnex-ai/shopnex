// Settings → Shipping: the "Free from" money input must keep what the owner types (junk is flagged, never
// rewritten to "NaN"), and a valid amount saves as minor units.
import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { Fixtures, PASSWORD, SHOP, requireApp } from '../lib'

const fx = new Fixtures()
const NAME = `E2E money rate ${Date.now()}`

test.beforeAll(async () => {
  await requireApp()
  await fx.init()
})

test.afterAll(async () => {
  await db.delete(schema.shippingRates).where(eq(schema.shippingRates.name, NAME))
  await fx.cleanup()
})

test('the Free from input keeps junk as typed and saves a valid amount', async ({ page }) => {
  const owner = await fx.account('owner')
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(/\/admin(\/)?$/)

  await page.goto('/admin/settings/shipping')
  await page.getByRole('button', { name: 'Add rate' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(NAME)
  await dialog.getByLabel('Price').fill('5')
  const freeFrom = dialog.getByLabel('Free from (optional)')

  // Junk stays exactly as typed (the bug rewrote it to "NaN")
  await freeFrom.fill('abc')
  await expect(freeFrom).toHaveValue('abc')
  await freeFrom.blur()
  await expect(freeFrom).not.toHaveValue(/NaN/)
  await dialog.getByRole('button', { name: 'Add rate' }).click()
  await expect(dialog).toBeVisible() // not saved while invalid

  await freeFrom.fill('49.5')
  await freeFrom.blur()
  await expect(freeFrom).toHaveValue('49.50')
  await dialog.getByRole('button', { name: 'Add rate' }).click()
  await expect(dialog).toBeHidden()

  const [row] = await db.select().from(schema.shippingRates).where(eq(schema.shippingRates.name, NAME))
  expect(row?.shopId).toBe(SHOP)
  expect(row?.priceCents).toBe(500)
  expect(row?.freeAboveCents).toBe(4950)
})
