// The Privacy card on a customer: owners and admins can download the customer's data and erase it, staff cannot see it.
// The rules of an erasure are in tests/customer-privacy.test.ts; this is the screen.
import { readFileSync } from 'node:fs'
import { customerService } from '@shopnex/customers'
import { orderService } from '@shopnex/orders'
import { expect, test, type Page } from './test'
import { Fixtures, PASSWORD, SHOP, requireApp, sellableVariants } from '../lib'

const fx = new Fixtures()
let owner: Awaited<ReturnType<Fixtures['account']>>
let member: Awaited<ReturnType<Fixtures['account']>>
let customer: NonNullable<Awaited<ReturnType<typeof customerService.create>>>
let order: Awaited<ReturnType<typeof orderService.create>>

test.beforeAll(async () => {
  await requireApp()
  await fx.init()
  owner = await fx.account('owner')
  member = await fx.account('member')
  customer = (await customerService.create(SHOP, { email: fx.shopper('browser-privacy'), name: 'Browser Privacy' }))!
  const [variant] = await sellableVariants(1)
  order = await orderService.create(SHOP, {
    customerId: customer.id,
    items: [{ variantId: variant!.id, quantity: 1 }],
    shippingAddress: {
      firstName: 'Browser',
      lastName: 'Privacy',
      company: null,
      address1: 'Datenweg 1',
      address2: null,
      city: 'Berlin',
      province: null,
      countryCode: 'DE',
      zip: '10115',
      phone: null,
    },
  })
  fx.order(order.id)
})

test.afterAll(async () => {
  await fx.cleanup()
})

async function signIn(page: Page, who: { email: string }) {
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(/\/admin(\/)?$/)
}

test('staff do not see the Privacy card', async ({ page }) => {
  await signIn(page, member)
  await page.goto(`/admin/customers/${customer.id}`)
  await expect(page.getByRole('heading', { name: 'Browser Privacy' })).toBeVisible()
  await expect(page.getByText('Privacy', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Erase personal data' })).toHaveCount(0)
})

test('an owner downloads the customer’s data as a JSON file', async ({ page }) => {
  await signIn(page, owner)
  await page.goto(`/admin/customers/${customer.id}`)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export data' }).click()
  const file = await download
  // No name or email in the file name
  expect(file.suggestedFilename()).toBe(`customer-data-${customer.id.slice(0, 8)}.json`)
  const data = JSON.parse(readFileSync((await file.path())!, 'utf8'))
  expect(data.customer.email).toBe(customer.email)
  expect(data.orders).toHaveLength(1)
  expect(data.orders[0].shippingAddress.address1).toBe('Datenweg 1')
})

test('erasing needs the email typed, is refused while an order is open, then erases once it is finished', async ({
  page,
}) => {
  await signIn(page, owner)
  await page.goto(`/admin/customers/${customer.id}`)
  await page.getByRole('button', { name: 'Erase personal data' }).click()
  const dialog = page.getByRole('dialog')
  const confirm = dialog.getByRole('button', { name: 'Erase personal data' })

  // The email has to be typed
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel(`Type ${customer.email} to confirm`).fill(customer.email.toUpperCase())
  await expect(confirm).toBeEnabled()

  // The order is still to be delivered: refused, with its number, and nothing is lost
  await confirm.click()
  await expect(dialog.getByText(`#${order.orderNumber}`)).toBeVisible()
  await expect(dialog.getByText('Fulfil or cancel them first')).toBeVisible()

  // Cancel the order and try again
  await orderService.cancel(SHOP, order.id, { reason: 'customer', restock: true })
  await confirm.click()
  await expect(page).toHaveURL(/\/admin\/customers$/)
  await expect(page.getByText('Personal data erased')).toBeVisible()

  await page.goto(`/admin/customers/${customer.id}`)
  // The admin retries a missing record for several seconds before it says so
  await expect(page.getByText('Customer not found')).toBeVisible({ timeout: 20_000 })
  // The order stays, without the buyer
  await page.goto(`/admin/orders/${order.id}`)
  await expect(page.getByText('Datenweg 1')).toHaveCount(0)
  await expect(page.getByText('(erased)').first()).toBeVisible()
})
