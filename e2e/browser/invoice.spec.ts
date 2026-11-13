// The printable invoice of an order: who issues it, who it is for, the lines, the tax by rate and the total, shown
// without the admin around it. Uses its own order and tax rate, and puts the shop's business details back.
import { orderService } from '@shopnex/orders'
import { taxService } from '@shopnex/pricing'
import { getShopById, updateShop } from '@shopnex/tenancy'
import { expect, test, type Page } from './test'
import { Fixtures, PASSWORD, SHOP, requireApp, sellableVariants } from '../lib'

const fx = new Fixtures()
let owner: Awaited<ReturnType<Fixtures['account']>>
let order: Awaited<ReturnType<typeof orderService.create>>
let before: NonNullable<Awaited<ReturnType<typeof getShopById>>>

const DETAILS = {
  legalName: 'E2E Trading GmbH',
  businessAddress: 'Teststrasse 1\n10115 Berlin\nGermany',
  taxId: 'DE123456789',
}
const money = (cents: number) =>
  new Intl.NumberFormat('en', { style: 'currency', currency: order.currency }).format(cents / 100)

test.beforeAll(async () => {
  await requireApp()
  await fx.init()
  before = (await getShopById(SHOP))!
  owner = await fx.account('owner')
  // Heard Island and McDonald Islands: a country no other test charges tax in
  fx.taxRate((await taxService.create(SHOP, { countryCode: 'HM', province: null, name: 'VAT', ratePercent: 19 })).id)
  await updateShop(SHOP, { taxesIncluded: true, taxShipping: false, ...DETAILS })
  const [variant] = await sellableVariants(1)
  order = await orderService.create(SHOP, {
    email: fx.email,
    items: [{ variantId: variant!.id, quantity: 2 }],
    shipping: { title: 'E2E standard', code: null, priceCents: 500, freeAboveCents: null },
    shippingAddress: {
      firstName: 'Erika',
      lastName: 'Mustermann',
      company: null,
      address1: 'Kundenweg 7',
      address2: null,
      city: 'Hamburg',
      province: null,
      countryCode: 'HM',
      zip: '20095',
      phone: null,
    },
  })
  fx.order(order.id)
})

test.afterAll(async () => {
  await updateShop(SHOP, {
    legalName: before.legalName,
    businessAddress: before.businessAddress,
    taxId: before.taxId,
  })
  await fx.cleanup()
})

async function signIn(page: Page) {
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(/\/admin(\/)?$/)
}

test('the invoice shows who issues it, who it is for, the tax by rate and the total, without the admin', async ({
  page,
}) => {
  expect(order.taxCents).toBeGreaterThan(0)
  await signIn(page)
  await page.goto(`/admin/orders/${order.id}/invoice`)

  await expect(page.getByRole('heading', { name: 'Invoice' })).toBeVisible()
  await expect(page.getByText(`INV-${order.orderNumber}`)).toBeVisible()
  // The issuer
  await expect(page.getByText('E2E Trading GmbH')).toBeVisible()
  await expect(page.getByText('Teststrasse 1')).toBeVisible()
  await expect(page.getByText('10115 Berlin')).toBeVisible()
  await expect(page.getByText('VAT / Tax ID: DE123456789')).toBeVisible()
  // The buyer
  await expect(page.getByText('Erika Mustermann')).toBeVisible()
  await expect(page.getByText('Kundenweg 7')).toBeVisible()
  // The money: net, tax at its rate, total
  await expect(page.getByText('Total excluding tax')).toBeVisible()
  await expect(page.getByText(money(order.totalCents - order.taxCents)).first()).toBeVisible()
  await expect(page.getByText('VAT 19%')).toBeVisible()
  await expect(page.getByText(money(order.taxCents)).first()).toBeVisible()
  await expect(page.getByText('Total incl. tax')).toBeVisible()
  await expect(page.getByText(money(order.totalCents)).first()).toBeVisible()
  await expect(page.getByText('Prices include tax.')).toBeVisible()
  // Nothing missing, and no admin menu around it
  await expect(page.getByText('This invoice has no')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Orders', exact: true })).toHaveCount(0)
})

test('printing leaves only the invoice: the toolbar is hidden', async ({ page }) => {
  await signIn(page)
  await page.goto(`/admin/orders/${order.id}/invoice`)
  await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeHidden()
  await expect(page.getByText(`INV-${order.orderNumber}`)).toBeVisible()
})

test('without business details the invoice uses the shop name and says what is missing', async ({ page }) => {
  await updateShop(SHOP, { legalName: null, businessAddress: null, taxId: null })
  try {
    await signIn(page)
    await page.goto(`/admin/orders/${order.id}/invoice`)
    await expect(page.getByText(before.name).first()).toBeVisible()
    await expect(page.getByText('This invoice has no business address and no VAT or tax number')).toBeVisible()
    await page.getByRole('link', { name: 'Add them in Settings' }).click()
    await expect(page).toHaveURL(/\/admin\/settings\/general/)
    await expect(page.getByText('Business details')).toBeVisible()
  } finally {
    await updateShop(SHOP, DETAILS)
  }
})

test('the order page links to its invoice', async ({ page }) => {
  await signIn(page)
  await page.goto(`/admin/orders/${order.id}`)
  const popup = page.waitForEvent('popup')
  await page.getByRole('link', { name: 'Invoice' }).click()
  const invoice = await popup
  await expect(invoice).toHaveURL(new RegExp(`/admin/orders/${order.id}/invoice$`))
  await expect(invoice.getByText(`INV-${order.orderNumber}`)).toBeVisible()
})

test('business details are saved from Settings and show on the invoice', async ({ page }) => {
  await signIn(page)
  await page.goto('/admin/settings/general')
  await page.getByLabel('Legal business name').fill('Changed Name Ltd')
  await page.getByLabel('VAT or tax number').fill('GB999999999')
  // The card's own Save: the General page has one per card
  await page
    .locator('form')
    .filter({ has: page.getByLabel('Legal business name') })
    .getByRole('button', { name: 'Save' })
    .click()
  await expect(page.getByText('Business details saved')).toBeVisible()
  await page.goto(`/admin/orders/${order.id}/invoice`)
  await expect(page.getByText('Changed Name Ltd')).toBeVisible()
  await expect(page.getByText('VAT / Tax ID: GB999999999')).toBeVisible()
})
