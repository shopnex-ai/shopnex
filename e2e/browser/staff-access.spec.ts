// What a staff member (the "member" role) reaches in the admin UI: the shop's daily work, never the screens that
// change how it runs. `auth` and `staff` check the same rule at the API; this checks the screens.
import { expect, test, type Page } from './test'
import { Fixtures, PASSWORD, requireApp } from '../lib'

const fx = new Fixtures()
let staff: Awaited<ReturnType<Fixtures['account']>>
let admin: Awaited<ReturnType<Fixtures['account']>>

// Every page under /admin/settings (apps/admin-ui/src/routes/admin/settings)
const SETTINGS = [
  'general',
  'staff',
  'ai',
  'domains',
  'payments',
  'shipping',
  'taxes',
  'storage',
  'api-tokens',
  'webhooks',
  'storefront-keys',
  'channels',
  'custom-fields',
  'email',
  'notifications',
  'marketplace',
]

test.beforeAll(async () => {
  await requireApp()
  await fx.init()
  staff = await fx.account('member')
  admin = await fx.account('admin')
})

test.afterAll(async () => {
  await fx.cleanup()
})

async function signIn(page: Page, email: string) {
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(/\/admin(\/)?$/)
}

async function restricted(page: Page, path: string, message: string) {
  await page.goto(path)
  await expect(page.getByRole('heading', { name: 'Access restricted' }), path).toBeVisible()
  await expect(page.getByText(message), path).toBeVisible()
}

test('a staff member is refused every settings page, apps and the platform, but works with orders', async ({
  page,
}) => {
  await signIn(page, staff.email)
  for (const name of SETTINGS) {
    await restricted(page, `/admin/settings/${name}`, 'Only shop owners and admins can change settings.')
  }
  // The old staff address forwards to the settings page, which is refused the same way
  await restricted(page, '/admin/staff', 'Only shop owners and admins can change settings.')
  await restricted(page, '/admin/apps', 'Only shop owners and admins can manage apps.')
  await restricted(page, '/admin/platform', 'Only super admins can see the platform.')

  await page.goto('/admin/orders')
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Access restricted' })).toHaveCount(0)
})

// Marketplace and the platform are for super admins only, so an admin is not checked there
test('an admin opens General and API tokens', async ({ page }) => {
  await signIn(page, admin.email)
  await page.goto('/admin/settings/general')
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible()
  await page.goto('/admin/settings/api-tokens')
  await expect(page.getByRole('heading', { name: 'API tokens' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Access restricted' })).toHaveCount(0)
})
