// (NaN itself can't be sent: JSON turns it into null, "no free-from"; the form sends junk as text.)
// Settings → Shipping rates through the Admin API: money is whole minor units, so NaN, text, fractions,
// negatives and out-of-range numbers are rejected on create and update, and a valid "free from" amount
// (or none) round-trips. Rates are removed at the end.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Fixtures, call, closeDb, ok, requireApp } from '../lib'

const fx = new Fixtures()
let auth: Record<string, string>
const created: string[] = []
const rate = (over: Record<string, unknown> = {}) => ({
  name: 'E2E rate',
  priceCents: 500,
  freeAboveCents: null,
  active: true,
  ...over,
})
const create = (over?: Record<string, unknown>) => call('POST', '/admin/shipping-rates', rate(over), auth)

describe('shipping rates', () => {
  before(async () => {
    await requireApp()
    await fx.init()
    auth = (await fx.account('owner')).headers
  })

  after(async () => {
    for (const id of created) await call('DELETE', `/admin/shipping-rates/${id}`, undefined, auth)
    await fx.cleanup()
    await closeDb()
  })

  test('rejects money that is not a whole non-negative number', async () => {
    const bad = ['NaN', 'abc', 10.5, -1, 1e20]
    for (const field of ['priceCents', 'freeAboveCents']) {
      for (const value of bad) {
        const r = await create({ [field]: value })
        assert.equal(r.status, 400, `${field}=${String(value)} → ${r.status} ${JSON.stringify(r.body)}`)
      }
    }
  })

  test('accepts a free-from amount, or none, and keeps it', async () => {
    const withFree = ok(await create({ freeAboveCents: 5000 }))
    created.push(withFree.id)
    assert.equal(withFree.freeAboveCents, 5000)
    const without = ok(await create({ freeAboveCents: null }))
    created.push(without.id)
    assert.equal(without.freeAboveCents, null)
    const zero = ok(await create({ priceCents: 0 }))
    created.push(zero.id)
    assert.equal(zero.priceCents, 0)
  })

  test('update applies the same rules', async () => {
    const { id } = ok(await create())
    created.push(id)
    for (const value of ['NaN', 2.5, -5]) {
      const r = await call('PATCH', `/admin/shipping-rates/${id}`, { freeAboveCents: value }, auth)
      assert.equal(r.status, 400, `freeAboveCents=${String(value)} → ${r.status}`)
    }
    const good = ok(await call('PATCH', `/admin/shipping-rates/${id}`, { freeAboveCents: 1999 }, auth))
    assert.equal(good.freeAboveCents, 1999)
    const cleared = ok(await call('PATCH', `/admin/shipping-rates/${id}`, { freeAboveCents: null }, auth))
    assert.equal(cleared.freeAboveCents, null)
  })
})
