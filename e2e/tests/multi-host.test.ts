// Multi mode: which shop a storefront request belongs to, decided by its host. Shops answer on
// <slug>.ROOT_DOMAIN with no DNS step, and on their own verified domains; nothing else resolves.
// The other e2e files run against a server in single mode; the tenancy config is read when the module loads, so
// this file (its own process under `node --test`) sets multi mode first and imports the code afterwards. It calls
// resolveStorefrontShop, which the API's storefront middleware runs on every request, against the real database.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

process.env.TENANCY_MODE = 'multi'
process.env.ROOT_DOMAIN = 'shopnex.test'
process.env.APP_URL = 'https://admin.shopnex.test'

const { eq, inArray } = await import('drizzle-orm')
const { db, schema } = await import('@shopnex/db')
const { DomainError, createShop, createStorefrontKey, domainService, getShopById, resolveStorefrontShop, updateShop } =
  await import('@shopnex/tenancy')

const run = randomBytes(3).toString('hex')
const ROOT = 'shopnex.test'
const resolve = (host: string, extra: Record<string, string> = {}) =>
  resolveStorefrontShop(new Headers({ host, ...extra }))

type Shop = Awaited<ReturnType<typeof createShop>>
let ownerId: string
let acme: Shop
let beta: Shop
const shopIds: string[] = []

// Shops inserted with a slug createShop would never produce (a reserved name, characters a host can't have)
async function rawShop(slug: string) {
  const id = `e2e-host-${run}-${slug.replace(/\W/g, '')}`
  await db.insert(schema.shops).values({ id, name: id, slug })
  shopIds.push(id)
  return id
}

before(async () => {
  ownerId = `e2e-host-owner-${run}`
  await db.insert(schema.user).values({ id: ownerId, name: 'E2E host owner', email: `${ownerId}@example.com` })
  acme = await createShop({ ownerId, name: `E2E Acme ${run}` })
  beta = await createShop({ ownerId, name: `E2E Beta ${run}` })
  shopIds.push(acme.id, beta.id)
})

after(async () => {
  // Domains, keys, channels and the rest of a shop's rows go with it (on delete cascade)
  await db.delete(schema.shops).where(inArray(schema.shops.id, shopIds))
  await db.delete(schema.user).where(eq(schema.user.id, ownerId))
  await db.$client.end()
})

const sub = (shop: Shop) => `${shop.slug}.${ROOT}`

describe('<slug>.ROOT_DOMAIN', () => {
  test('each subdomain is its own shop', async () => {
    assert.match(acme.slug, /^e2e-acme-/)
    const a = await resolve(sub(acme))
    const b = await resolve(sub(beta))
    assert.ok(a.ok && b.ok)
    assert.equal(a.shop.id, acme.id)
    assert.equal(b.shop.id, beta.id)
    assert.notEqual(a.channelId, b.channelId, 'each shop has its own Online Store channel')
  })

  test('case, a port and x-forwarded-host are handled', async () => {
    const upper = await resolve(sub(acme).toUpperCase())
    assert.ok(upper.ok && upper.shop.id === acme.id)
    const port = await resolve(`${sub(acme)}:8443`)
    assert.ok(port.ok && port.shop.id === acme.id)
    // The proxy's view of the buyer's host wins over the internal one
    const forwarded = await resolve('localhost:3001', { 'x-forwarded-host': sub(beta) })
    assert.ok(forwarded.ok && forwarded.shop.id === beta.id)
  })

  test('a subdomain nobody has is not found', async () => {
    const r = await resolve(`nobody-${run}.${ROOT}`)
    assert.deepEqual(r, { ok: false, reason: 'shop_not_found' })
  })

  test('the root, deeper hosts and other domains are not shops', async () => {
    for (const host of [ROOT, `x.${sub(acme)}`, `${acme.slug}.example.com`, `${acme.slug}${ROOT}`, 'localhost']) {
      assert.deepEqual(await resolve(host), { ok: false, reason: 'shop_not_found' }, host)
    }
  })

  test('platform names never resolve, even for a shop that has the slug', async () => {
    await rawShop('admin')
    await rawShop('www')
    for (const label of ['admin', 'www']) {
      assert.deepEqual(await resolve(`${label}.${ROOT}`), { ok: false, reason: 'shop_not_found' }, label)
    }
  })

  test('a slug a host cannot have never resolves', async () => {
    const id = await rawShop(`My_Shop-${run}`)
    assert.deepEqual(await resolve(`my_shop-${run}.${ROOT}`), { ok: false, reason: 'shop_not_found' })
    assert.equal((await getShopById(id))?.storefrontUrl, null, 'and gets no address')
  })

  test('a publishable key beats the host', async () => {
    const key = await createStorefrontKey(beta.id, 'e2e')
    const r = await resolve(sub(acme), { 'x-shopnex-key': key.token })
    assert.ok(r.ok && r.shop.id === beta.id)
    assert.deepEqual(await resolve(sub(acme), { 'x-shopnex-key': 'pk_nope' }), { ok: false, reason: 'invalid_key' })
  })
})

describe('storefront URL', () => {
  test('a shop with none saved gets its subdomain', async () => {
    assert.equal((await getShopById(acme.id))?.storefrontUrl, `https://${sub(acme)}`)
  })

  test('a saved one wins', async () => {
    await updateShop(beta.id, { storefrontUrl: 'https://shop.beta.example' })
    assert.equal((await getShopById(beta.id))?.storefrontUrl, 'https://shop.beta.example')
    assert.equal((await getShopById(acme.id))?.storefrontUrl, `https://${sub(acme)}`)
  })
})

describe('slugs from createShop', () => {
  test('a name the platform keeps gets a different slug', async () => {
    for (const name of ['Admin', 'WWW', 'Api']) {
      const shop = await createShop({ ownerId, name })
      shopIds.push(shop.id)
      assert.notEqual(shop.slug, name.toLowerCase())
      assert.match(shop.slug, new RegExp(`^${name.toLowerCase()}-`))
      const r = await resolve(`${shop.slug}.${ROOT}`)
      assert.ok(r.ok && r.shop.id === shop.id, 'and the new slug works')
    }
  })
})

describe('custom domains', () => {
  const domain = `shop-${run}.e2e-host.example.com`

  test('only a verified domain resolves', async () => {
    const row = await domainService.addDomain(acme.id, domain)
    assert.deepEqual(await resolve(domain), { ok: false, reason: 'shop_not_found' }, 'unverified')

    await db.update(schema.shopDomains).set({ verifiedAt: new Date() }).where(eq(schema.shopDomains.id, row.id))
    const r = await resolve(domain)
    assert.ok(r.ok && r.shop.id === acme.id, 'verified')
    // The subdomain keeps working next to it
    const s = await resolve(sub(acme))
    assert.ok(s.ok && s.shop.id === acme.id)
  })

  test('a domain under the root domain cannot be claimed', async () => {
    for (const bad of [ROOT, `evil.${ROOT}`, `https://${acme.slug}.${ROOT}/`]) {
      await assert.rejects(
        () => domainService.addDomain(beta.id, bad),
        (error) => error instanceof DomainError && error.code === 'INVALID_DOMAIN',
        bad,
      )
    }
  })
})
