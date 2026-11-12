// Creating a shop for an account (self-serve signup, OPEN_SIGNUP=true): the owner membership, a unique slug
// and a menu (no made-up shipping rate or payment method). The signup route itself needs a server in multi mode and isn't covered here.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import { seedSampleProducts } from '@shopnex/catalog'
import { channelService, publicationService } from '@shopnex/channels'
import { createShop } from '@shopnex/tenancy'
import { Fixtures, closeDb, requireApp } from '../lib'

const fx = new Fixtures()
const created: string[] = []
let owner: Awaited<ReturnType<Fixtures['account']>>

before(async () => {
  await requireApp()
  await fx.init()
  owner = await fx.account('outsider')
})

after(async () => {
  // Shop-scoped rows go with the shop (on delete cascade)
  if (created.length) await db.delete(schema.shops).where(inArray(schema.shops.id, created))
  await fx.cleanup()
  await closeDb()
})

describe('createShop', () => {
  test('makes the account the owner and leaves shipping and payments to the owner', async () => {
    const shop = await createShop({ ownerId: owner.id, name: '  E2E Provisioned  ' })
    created.push(shop.id)
    assert.equal(shop.name, 'E2E Provisioned')
    assert.match(shop.slug, /^shop-[0-9a-f]{8}$/)

    const [member] = await db
      .select()
      .from(schema.shopMembers)
      .where(and(eq(schema.shopMembers.organizationId, shop.id), eq(schema.shopMembers.userId, owner.id)))
    assert.equal(member?.role, 'owner')

    const rates = await db.select().from(schema.shippingRates).where(eq(schema.shippingRates.shopId, shop.id))
    assert.equal(rates.length, 0)
    const methods = await db.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.shopId, shop.id))
    assert.equal(methods.length, 0)

    // The storefront header and footer have links from the first visit, with no product or collection needed
    const menus = await db.select().from(schema.menus).where(eq(schema.menus.shopId, shop.id))
    assert.deepEqual(
      menus.map((m) => [m.handle, m.items.map((i) => i.type)]).sort(([a], [b]) => String(a).localeCompare(String(b))),
      [
        ['footer', ['search']],
        ['main-menu', ['frontpage', 'catalog']],
      ],
    )
  })

  test('the slug is a random handle: the same name twice gets different slugs, none made from the name', async () => {
    const [a, b] = [
      await createShop({ ownerId: owner.id, name: 'E2E Twin' }),
      await createShop({ ownerId: owner.id, name: 'E2E Twin' }),
    ]
    created.push(a.id, b.id)
    assert.notEqual(a.slug, b.slug)
    for (const slug of [a.slug, b.slug]) assert.match(slug, /^shop-[0-9a-f]{8}$/)
  })

  test('sample products are active, scoped to the shop and on its Online Store', async () => {
    const shop = await createShop({ ownerId: owner.id, name: 'E2E Samples' })
    created.push(shop.id)
    assert.equal(await seedSampleProducts(shop.id), 4)
    // Asking again adds nothing
    assert.equal(await seedSampleProducts(shop.id), 0)
    const products = await db.select().from(schema.products).where(eq(schema.products.shopId, shop.id))
    assert.equal(products.length, 4)
    assert.ok(products.every((p) => p.status === 'active'))
    // Published on the Online Store, or the storefront would show an empty catalog
    const channel = await channelService.getDefault(shop.id)
    const live = await publicationService.liveIds(
      shop.id,
      channel.id,
      'product',
      products.map((p) => p.id),
    )
    assert.equal(live.size, 4)
  })
})
