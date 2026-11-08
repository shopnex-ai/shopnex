// A shop's storefront language, end to end: staff set it in Settings (owners and admins only), the storefront API
// reports it, the storefront's pages carry it and write prices the way it writes them, and every order remembers the
// language it was placed in. Needs the storefront running (STOREFRONT_URL, default http://localhost:4321). The shop's
// language is put back at the end.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { orderService } from '@shopnex/orders'
import { getShopById, updateShop } from '@shopnex/tenancy'
import { Fixtures, SHOP, call, closeDb, ok, requireApp, sellableVariants } from '../lib'

const STOREFRONT = (process.env.STOREFRONT_URL ?? 'http://localhost:4321').replace(/\/$/, '')

const fx = new Fixtures()
let original: string
let owner: Record<string, string>
let member: Record<string, string>
let variant: { id: string }

const setLanguage = (language: string) => updateShop(SHOP, { language })
const page = async (path: string) => (await fetch(STOREFRONT + path)).text()
const written = (locale: string, currency: string, minor: number) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100)

const address = {
  firstName: 'Ada',
  lastName: 'Tester',
  company: null,
  address1: '1 Main St',
  address2: null,
  city: 'Somewhere',
  province: null,
  countryCode: 'US',
  zip: '10001',
  phone: null,
}
const placeOrder = async () => {
  const order = await orderService.create(SHOP, {
    email: fx.email,
    name: 'Ada Tester',
    items: [{ variantId: variant.id, quantity: 1 }],
    shippingAddress: address,
    payment: { gateway: 'manual', name: 'Bank transfer', instructions: 'IBAN 123' },
  })
  fx.order(order.id)
  return order
}

before(async () => {
  await requireApp()
  await fx.init()
  original = (await getShopById(SHOP))!.language
  const [ownerAccount, memberAccount] = await Promise.all([fx.account('owner'), fx.account('member')])
  owner = ownerAccount.headers
  member = memberAccount.headers
  variant = (await sellableVariants(1))[0]!
})

after(async () => {
  await setLanguage(original)
  await fx.cleanup()
  await closeDb()
})

describe('setting the language', () => {
  test('an owner sets it; it is stored in its canonical form and the storefront API reports it', async () => {
    const saved = ok(await call('PATCH', '/admin/shop', { language: 'pt-br' }, owner))
    assert.equal(saved.language, 'pt-BR', 'pt-br is stored as pt-BR')
    assert.equal(ok(await call('GET', '/storefront/shop')).languageCode, 'pt-BR')
    ok(await call('PATCH', '/admin/shop', { language: 'fr' }, owner))
    assert.equal(ok(await call('GET', '/storefront/shop')).languageCode, 'fr')
  })

  test('something that is not a language is refused, and a member cannot change it', async () => {
    await setLanguage('en')
    for (const bad of ['', 'english', 'en_US', 'x', '<script>', 'und']) {
      assert.equal((await call('PATCH', '/admin/shop', { language: bad }, owner)).status, 400, JSON.stringify(bad))
    }
    assert.equal((await call('PATCH', '/admin/shop', { language: 'fr' }, member)).status, 403, 'a member')
    assert.equal((await getShopById(SHOP))!.language, 'en', 'nothing changed')
  })

  test('the shop service refuses a bad tag too, not just the API', async () => {
    await assert.rejects(setLanguage('not a tag'), /not a language tag/)
    assert.equal((await getShopById(SHOP))!.language, 'en')
  })
})

describe('the storefront', () => {
  test('carries the shop’s language on its pages and writes prices the way that language writes them', async () => {
    const list = ok(await call('GET', '/storefront/products?first=1'))
    const product = list.nodes[0]
    assert.ok(product, 'the shop needs a product for this test')
    const prices = [
      product.priceRange.minVariantPrice,
      ...product.variants.map((v: { price: unknown }) => v.price),
    ] as {
      amountMinor: number
      currencyCode: string
    }[]

    await setLanguage('fr')
    const french = await page(`/products/${product.handle}`)
    assert.match(french, /<html lang="fr"/)
    assert.ok(
      prices.some((p) => french.includes(written('fr', p.currencyCode, p.amountMinor))),
      `a price written in French (${prices.map((p) => written('fr', p.currencyCode, p.amountMinor)).join(' | ')})`,
    )

    await setLanguage('en')
    const english = await page(`/products/${product.handle}`)
    assert.match(english, /<html lang="en"/)
    assert.ok(
      prices.some((p) => english.includes(written('en', p.currencyCode, p.amountMinor))),
      'and in English once it is English again',
    )
    assert.doesNotMatch(english, /<html lang="fr"/)
  })
})

describe('orders', () => {
  test('an order keeps the language it was placed in, whatever the shop changes to later', async () => {
    const token = await fx.token(['read_orders'])
    await setLanguage('de')
    const first = await placeOrder()
    await setLanguage('fr')
    const second = await placeOrder()

    assert.equal(first.languageCode, 'de')
    assert.equal(second.languageCode, 'fr')
    // …and the Admin API says so, from the database, not from this process
    assert.equal(ok(await call('GET', `/admin/orders/${first.id}`, undefined, token)).languageCode, 'de')
    assert.equal(ok(await call('GET', `/admin/orders/${second.id}`, undefined, token)).languageCode, 'fr')
  })
})

describe('other shops', () => {
  test('one shop’s language does not change another’s', async () => {
    await setLanguage('fr')
    const other = await fx.shop()
    assert.equal((await getShopById(other.id))!.language, 'en', 'a new shop starts in English')
    await updateShop(other.id, { language: 'de' })
    assert.equal((await getShopById(SHOP))!.language, 'fr', 'and changing it leaves this shop alone')
  })
})
