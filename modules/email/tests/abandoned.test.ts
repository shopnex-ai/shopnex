import type { Conn } from '@shopnex/db'
// Abandoned cart reminders: the shop's switch and delay, the unsubscribe link, which checkouts are due (and which never are), what is
// queued for them and what is skipped, and that a checkout is reminded once.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'
import { abandonedCartSettings, emailDeliveries, emailSuppressions } from '../src/email.schema'
import { carts } from '@shopnex/cart/schema'
import { products } from '@shopnex/catalog/schema'

const { db, eq, SHOP, OTHER_SHOP } = fx
const { abandonedCartService, queueAbandonedCartEmails, EmailError } = await import('../src')
const { reasonToSkip } = await import('../src/abandoned-carts')

const refused = (code: string) => (e: unknown) => e instanceof EmailError && e.code === code
const deliveriesOf = (cartId: string) => db.select().from(emailDeliveries).where(eq(emailDeliveries.cartId, cartId))

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
})
beforeEach(fx.cleanup)
after(fx.cleanup)

describe('the settings', () => {
  test('off, one hour, until the shop changes them', async () => {
    assert.deepEqual(await abandonedCartService.getSettings(SHOP, db), { enabled: false, delayMinutes: 60 })
    assert.deepEqual(
      [
        abandonedCartService.DEFAULT_DELAY_MINUTES,
        abandonedCartService.MIN_DELAY_MINUTES,
        abandonedCartService.MAX_DELAY_MINUTES,
      ],
      [60, 15, 10_080],
    )
  })

  test('the switch and the delay can be changed separately, per shop', async () => {
    assert.deepEqual(await abandonedCartService.updateSettings(SHOP, { enabled: true }, db), {
      enabled: true,
      delayMinutes: 60,
    })
    assert.deepEqual(await abandonedCartService.updateSettings(SHOP, { delayMinutes: 120 }, db), {
      enabled: true,
      delayMinutes: 120,
    })
    assert.deepEqual(await abandonedCartService.getSettings(OTHER_SHOP, db), { enabled: false, delayMinutes: 60 })
  })

  test('the delay is whole minutes from 15 minutes to 7 days; anything else is refused and changes nothing', async () => {
    for (const bad of [14, 10_081, 30.5, Number.NaN])
      await assert.rejects(
        abandonedCartService.updateSettings(SHOP, { delayMinutes: bad }, db),
        refused('INVALID_TEMPLATE'),
        String(bad),
      )
    for (const ok of [15, 10_080])
      assert.equal((await abandonedCartService.updateSettings(SHOP, { delayMinutes: ok }, db)).delayMinutes, ok)
    assert.equal((await db.select().from(abandonedCartSettings)).length, 1)
  })

  test('the checkout offers the reminder checkbox only when the switch is on and the shop can send email', async () => {
    assert.equal(await abandonedCartService.offered(SHOP, db), false)
    await abandonedCartService.updateSettings(SHOP, { enabled: true }, db)
    assert.equal(await abandonedCartService.offered(SHOP, db), false, 'email is off')
    await fx.turnOn()
    assert.equal(await abandonedCartService.offered(SHOP, db), true)
    await abandonedCartService.updateSettings(SHOP, { enabled: false }, db)
    assert.equal(await abandonedCartService.offered(SHOP, db), false)
  })
})

describe('the unsubscribe link', () => {
  test('a token names the shop and the address in lower case, and anyone can read who it unsubscribes', () => {
    const token = abandonedCartService.unsubscribeToken(SHOP, ' Shopper@Example.TEST ')
    assert.deepEqual(abandonedCartService.whoUnsubscribes(token), { shopId: SHOP, email: 'shopper@example.test' })
    assert.equal(token, abandonedCartService.unsubscribeToken(SHOP, 'shopper@example.test'))
  })

  test('a forged, edited or damaged token is nobody and unsubscribes nobody', async () => {
    const token = abandonedCartService.unsubscribeToken(SHOP, 'shopper@example.test')
    const [payload] = token.split('.')
    const other = Buffer.from(JSON.stringify([SHOP, 'victim@example.test'])).toString('base64url')
    for (const bad of [
      '',
      'nope',
      `${payload}.`,
      `.${token.split('.')[1]}`,
      `${other}.${token.split('.')[1]}`,
      `${payload}.AAAA`,
      `${token}x`,
    ]) {
      assert.equal(abandonedCartService.whoUnsubscribes(bad), null, bad)
      assert.equal(await abandonedCartService.unsubscribe(bad, db), false, bad)
    }
    assert.equal((await db.select().from(emailSuppressions)).length, 0)
  })

  test('unsubscribing is recorded once however often the link is used, and only for that shop', async () => {
    const token = abandonedCartService.unsubscribeToken(SHOP, 'Shopper@example.test')
    assert.equal(await abandonedCartService.unsubscribe(token, db), true)
    assert.equal(await abandonedCartService.unsubscribe(token, db), true)
    assert.equal((await db.select().from(emailSuppressions)).length, 1)
    assert.equal(await abandonedCartService.isSuppressed(db, SHOP, ' SHOPPER@example.test'), true)
    assert.equal(await abandonedCartService.isSuppressed(db, OTHER_SHOP, 'shopper@example.test'), false)
    assert.equal(await abandonedCartService.isSuppressed(db, SHOP, 'someone@example.test'), false)
  })
})

describe('which checkouts are reminded', () => {
  beforeEach(async () => {
    await fx.turnOn()
    await abandonedCartService.updateSettings(SHOP, { enabled: true, delayMinutes: 60 }, db)
  })

  test('one that has been quiet for the delay, with an email and something in it: a reminder to that address, queued once', async () => {
    const c = await fx.cart({ idleMinutes: 90, email: 'shopper@example.test' })
    assert.equal(await queueAbandonedCartEmails(db), 1)
    const [delivery] = await deliveriesOf(c.id)
    assert.deepEqual(
      [delivery?.notification, delivery?.to, delivery?.status, delivery?.orderId],
      ['abandoned_cart', 'shopper@example.test', 'pending', null],
    )
    assert.match(delivery!.html, new RegExp(`/checkout/${c.token}`))
    assert.match(delivery!.html, /\/unsubscribe\//)
    assert.match(delivery!.html, /Linen shirt/)
    assert.equal(await queueAbandonedCartEmails(db), 0, 'a second pass finds nothing to do')
    assert.equal((await deliveriesOf(c.id)).length, 1)
  })

  test('the greeting uses the first name of the customer with that email', async () => {
    await fx.customer({ email: 'shopper@example.test', name: 'Ada Lovelace' })
    const c = await fx.cart({ idleMinutes: 90 })
    await queueAbandonedCartEmails(db)
    assert.match((await deliveriesOf(c.id))[0]!.html, /Ada/)
  })

  test('not yet: the delay has not passed, and a checkout touched since is not due', async () => {
    const fresh = await fx.cart({ idleMinutes: 30 })
    assert.equal(await queueAbandonedCartEmails(db), 0)
    assert.equal((await deliveriesOf(fresh.id)).length, 0)
  })

  test('never: no email, an empty cart, an expired one, one already checked out, or too old (turning it on must not mail every old checkout)', async () => {
    await fx.cart({ idleMinutes: 90, email: null })
    await fx.cart({ idleMinutes: 90, lines: 0 })
    const expired = await fx.cart({ idleMinutes: 90 })
    await db
      .update(carts)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(carts.id, expired.id))
    await fx.cart({ idleMinutes: 90, status: 'completed' })
    await fx.cart({ idleMinutes: 60 + 25 * 60 })
    assert.equal(await queueAbandonedCartEmails(db), 0)
    assert.equal((await db.select().from(emailDeliveries)).length, 0)
  })

  test('never in a shop where the switch is off or email is off', async () => {
    const c = await fx.cart({ idleMinutes: 90 })
    await abandonedCartService.updateSettings(SHOP, { enabled: false }, db)
    assert.equal(await queueAbandonedCartEmails(db), 0)
    await abandonedCartService.updateSettings(SHOP, { enabled: true }, db)
    await fx.turnOn({ active: false })
    assert.equal(await queueAbandonedCartEmails(db), 0)
    assert.equal((await deliveriesOf(c.id)).length, 0)
  })

  test('the delay is the shop’s own', async () => {
    const c = await fx.cart({ idleMinutes: 90 })
    await abandonedCartService.updateSettings(SHOP, { delayMinutes: 120 }, db)
    assert.equal(await queueAbandonedCartEmails(db), 0)
    await abandonedCartService.updateSettings(SHOP, { delayMinutes: 60 }, db)
    assert.equal(await queueAbandonedCartEmails(db), 1)
    assert.equal((await deliveriesOf(c.id)).length, 1)
  })

  test('an address that unsubscribed is recorded as skipped, not mailed, and not looked at again', async () => {
    await abandonedCartService.unsubscribe(abandonedCartService.unsubscribeToken(SHOP, 'shopper@example.test'), db)
    const c = await fx.cart({ idleMinutes: 90 })
    assert.equal(await queueAbandonedCartEmails(db), 1)
    const [delivery] = await deliveriesOf(c.id)
    assert.deepEqual([delivery?.status, delivery?.lastError, delivery?.html], ['skipped', 'Unsubscribed', ''])
    assert.equal(await queueAbandonedCartEmails(db), 0)
  })

  test('a cart whose products are no longer for sale is skipped for having nothing left', async () => {
    const c = await fx.cart({ idleMinutes: 90 })
    await db.update(products).set({ status: 'archived' })
    await queueAbandonedCartEmails(db)
    const [delivery] = await deliveriesOf(c.id)
    assert.deepEqual([delivery?.status, delivery?.lastError], ['skipped', 'Nothing left in the cart'])
  })

  test('the oldest are handled first, at most twenty a pass', async () => {
    for (let i = 0; i < 22; i++) await fx.cart({ idleMinutes: 90 + i })
    assert.equal(await queueAbandonedCartEmails(db), 20)
    assert.equal(await queueAbandonedCartEmails(db), 2)
  })
})

describe('just before sending', () => {
  test('a reminder is dropped when the checkout was completed since, or the address unsubscribed since', async () => {
    const c = await fx.cart()
    const delivery = { shopId: SHOP, cartId: c.id, to: 'shopper@example.test' }
    assert.equal(await reasonToSkip(delivery, db), null)
    await abandonedCartService.unsubscribe(abandonedCartService.unsubscribeToken(SHOP, 'shopper@example.test'), db)
    assert.equal(await reasonToSkip(delivery, db), 'Unsubscribed')
    await db.update(carts).set({ status: 'completed' }).where(eq(carts.id, c.id))
    assert.equal(await reasonToSkip(delivery, db), 'Checkout was completed')
  })

  test('an email that is not about a cart is never dropped for these reasons', async () => {
    assert.equal(await reasonToSkip({ shopId: SHOP, cartId: null, to: 'a@example.test' }, db), null)
  })
})
