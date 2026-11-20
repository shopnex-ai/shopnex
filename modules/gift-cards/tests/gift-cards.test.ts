import assert from 'node:assert/strict'
import test, { before, describe } from 'node:test'
import { shops } from '@shopnex/core/schema'

process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
requireEmbeddedDatabase()
const svc = await import('../src/gift-cards')
const { GiftCardError } = await import('../src/gift-cards.errors')

const SHOP = 'default'
const OTHER = 'gift-cards-other'

before(async () => {
  await prepareDatabase()
  await db.insert(shops).values({ id: OTHER, name: 'Other', slug: OTHER }).onConflictDoNothing()
})

const rejects = (code: string) => (e: unknown) => e instanceof GiftCardError && e.code === code

describe('codes', () => {
  test('generated codes are 16 characters without lookalikes, and differ', () => {
    const a = svc.generateCode()
    assert.match(a, /^[A-HJKMNP-Z2-9]{16}$/)
    assert.notEqual(a, svc.generateCode())
  })

  test('what a buyer types is normalized, and the display form round-trips', () => {
    assert.equal(svc.normalizeCode(' abcd-efgh jkmn-pqrs '), 'ABCDEFGHJKMNPQRS')
    assert.equal(svc.formatCode('ABCDEFGHJKMNPQRS'), 'ABCD-EFGH-JKMN-PQRS')
    assert.equal(svc.normalizeCode(svc.formatCode('ABCDEFGHJKMNPQRS')), 'ABCDEFGHJKMNPQRS')
  })
})

describe('issue and redeem', () => {
  test('a new card holds its amount and has an issue transaction', async () => {
    const card = await svc.issue(SHOP, { amountCents: 5000 }, db)
    assert.equal(card.balanceCents, 5000)
    assert.equal(card.initialCents, 5000)
    const detail = await svc.getById(SHOP, card.id, db)
    assert.deepEqual(
      detail!.transactions.map((t) => [t.kind, t.amountCents, t.balanceAfterCents]),
      [['issue', 5000, 5000]],
    )
  })

  test('an amount that is not a positive whole number is refused', async () => {
    await assert.rejects(svc.issue(SHOP, { amountCents: 0 }, db), rejects('INVALID_GIFT_CARD'))
    await assert.rejects(svc.issue(SHOP, { amountCents: 10.5 }, db), rejects('INVALID_GIFT_CARD'))
  })

  test('redeeming takes from the balance and leaves the rest', async () => {
    const card = await svc.issue(SHOP, { amountCents: 5000 }, db)
    const after = await db.transaction((tx) => svc.redeem(tx, SHOP, card.id, 1800, crypto.randomUUID()))
    assert.equal(after.balanceCents, 3200)
  })

  test('a card cannot be overspent', async () => {
    const card = await svc.issue(SHOP, { amountCents: 1000 }, db)
    await assert.rejects(
      db.transaction((tx) => svc.redeem(tx, SHOP, card.id, 1001, crypto.randomUUID())),
      rejects('INSUFFICIENT_BALANCE'),
    )
    assert.equal((await svc.getById(SHOP, card.id, db))!.balanceCents, 1000)
  })

  test('two orders racing for one card cannot spend more than it holds', async () => {
    const card = await svc.issue(SHOP, { amountCents: 1000 }, db)
    const spend = () => db.transaction((tx) => svc.redeem(tx, SHOP, card.id, 700, crypto.randomUUID()))
    const results = await Promise.allSettled([spend(), spend()])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal((await svc.getById(SHOP, card.id, db))!.balanceCents, 300)
  })

  test('a spend is undone with the order: a rolled back transaction keeps the balance', async () => {
    const card = await svc.issue(SHOP, { amountCents: 1000 }, db)
    await assert.rejects(
      db.transaction(async (tx) => {
        await svc.redeem(tx, SHOP, card.id, 400, crypto.randomUUID())
        throw new Error('order failed')
      }),
      /order failed/,
    )
    assert.equal((await svc.getById(SHOP, card.id, db))!.balanceCents, 1000)
  })

  test('refund puts a spend back', async () => {
    const card = await svc.issue(SHOP, { amountCents: 1000 }, db)
    const order = crypto.randomUUID()
    await db.transaction((tx) => svc.redeem(tx, SHOP, card.id, 600, order))
    const after = await db.transaction((tx) => svc.refund(tx, SHOP, card.id, 600, order))
    assert.equal(after.balanceCents, 1000)
  })
})

describe('availability', () => {
  test('a card can be spent unless it is disabled, expired or empty', async () => {
    const card = await svc.issue(SHOP, { amountCents: 1000 }, db)
    assert.equal(svc.unavailableReason(card), null)
    assert.match(svc.unavailableReason({ ...card, active: false })!, /disabled/)
    assert.match(svc.unavailableReason({ ...card, expiresAt: new Date(Date.now() - 1000) })!, /expired/)
    assert.match(svc.unavailableReason({ ...card, balanceCents: 0 })!, /no balance/)
  })

  test('a disabled card cannot be redeemed, and enabling it again works', async () => {
    const card = await svc.issue(SHOP, { amountCents: 1000 }, db)
    await svc.setActive(SHOP, card.id, false, db)
    await assert.rejects(
      db.transaction((tx) => svc.redeem(tx, SHOP, card.id, 100, crypto.randomUUID())),
      rejects('GIFT_CARD_UNAVAILABLE'),
    )
    await svc.setActive(SHOP, card.id, true, db)
    await db.transaction((tx) => svc.redeem(tx, SHOP, card.id, 100, crypto.randomUUID()))
  })

  test('coverage is the balance, or the amount due when that is less', () => {
    assert.equal(svc.coverage({ balanceCents: 500 }, 1200), 500)
    assert.equal(svc.coverage({ balanceCents: 5000 }, 1200), 1200)
    assert.equal(svc.coverage({ balanceCents: 500 }, 0), 0)
  })
})

describe('lookup and isolation', () => {
  test('a code is found however it is typed, and only in its own shop', async () => {
    const card = await svc.issue(SHOP, { amountCents: 1000 }, db)
    const typed = svc.formatCode(card.code).toLowerCase()
    assert.equal((await svc.findByCode(SHOP, typed, db))?.id, card.id)
    assert.equal(await svc.findByCode(OTHER, typed, db), null)
    assert.equal(await svc.getById(OTHER, card.id, db), null)
  })

  test('adjusting changes the balance, with a transaction, and never below zero', async () => {
    const card = await svc.issue(SHOP, { amountCents: 1000 }, db)
    assert.equal((await svc.adjust(SHOP, card.id, 250, 'goodwill', db)).balanceCents, 1250)
    await assert.rejects(svc.adjust(SHOP, card.id, -5000, null, db), rejects('INSUFFICIENT_BALANCE'))
    await assert.rejects(svc.adjust(SHOP, card.id, 0, null, db), rejects('INVALID_GIFT_CARD'))
  })
})
