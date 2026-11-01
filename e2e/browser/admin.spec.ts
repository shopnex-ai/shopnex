// Signing in to the admin and the header's "View store" link.
import { expect, test } from '@playwright/test'
import { Fixtures, PASSWORD, requireApp } from '../lib'

const fx = new Fixtures()
let owner: Awaited<ReturnType<Fixtures['account']>>

test.beforeAll(async () => {
  await requireApp()
  await fx.init()
  owner = await fx.account('owner')
})

test.afterAll(async () => {
  await fx.cleanup()
})

test('wrong password is rejected, right one reaches the dashboard', async ({ page }) => {
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill('not-the-password')
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page).toHaveURL(/\/admin\/login/)

  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(/\/admin(\/)?$/)
  await expect(page.getByRole('link', { name: 'Orders' }).first()).toBeVisible()
})

test('unauthenticated visitors are sent to the login page', async ({ page }) => {
  await page.goto('/admin/orders')
  await expect(page).toHaveURL(/\/admin\/login/)
})
