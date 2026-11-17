// Settings → Webhooks and the API apps use: endpoints scoped by shop, and by the API token that made them when a token is calling.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'

const { db, schema, SHOP, OTHER_SHOP, webhookDeliveries } = fx
const { bindConn } = await import('@shopnex/kit')
const webhookService = bindConn((await import('../src')).webhookService, db)
const { eq } = await import('drizzle-orm')

before(async () => {
  await fx.prepareDatabase()
  await fx.otherShop()
})
beforeEach(fx.cleanup)
after(fx.cleanup)

const input = { url: 'https://example.com/hook', description: 'Zapier', topics: ['order.created' as const] }

describe('create and read', () => {
  test('creates an active endpoint with its own secret, added by staff (no token)', async () => {
    const e = await webhookService.create(SHOP, input, undefined)
    assert.equal(e.shopId, SHOP)
    assert.equal(e.url, input.url)
    assert.deepEqual(e.topics, ['order.created'])
    assert.equal(e.active, true)
    assert.equal(e.apiTokenId, null)
    assert.match(e.secret, /^whsec_/)
    assert.notEqual((await webhookService.create(SHOP, input, undefined)).secret, e.secret)
  })

  test('active can be created off', async () => {
    assert.equal((await webhookService.create(SHOP, { ...input, active: false }, undefined)).active, false)
  })

  test('list: newest first, with who made each (staff: nobody; a token or an app: its name)', async () => {
    const token = await fx.apiToken({ name: 'My script' })
    const staff = await webhookService.create(SHOP, input, undefined)
    const byToken = await webhookService.create(SHOP, input, token.id)
    const rows = await webhookService.list(SHOP, undefined)
    assert.deepEqual(
      rows.map((r) => r.id),
      [byToken.id, staff.id],
    )
    assert.deepEqual(
      rows.map((r) => [r.apiTokenName, r.createdByApp]),
      [
        ['My script', false],
        [null, false],
      ],
    )
  })

  test('a token sees only its own endpoints; staff see all; another shop sees none', async () => {
    const mine = await fx.apiToken()
    const theirs = await fx.apiToken()
    const a = await webhookService.create(SHOP, input, mine.id)
    await webhookService.create(SHOP, input, theirs.id)
    await webhookService.create(SHOP, input, undefined)
    assert.deepEqual(
      (await webhookService.list(SHOP, mine.id)).map((r) => r.id),
      [a.id],
    )
    assert.equal((await webhookService.list(SHOP, undefined)).length, 3)
    assert.equal((await webhookService.list(OTHER_SHOP, undefined)).length, 0)
    assert.equal(await webhookService.get(SHOP, a.id, theirs.id), null)
    assert.equal(await webhookService.get(OTHER_SHOP, a.id, undefined), null)
    assert.equal((await webhookService.get(SHOP, a.id, mine.id))?.id, a.id)
  })
})

describe('update, rotate and remove', () => {
  test('update changes only what is given and stamps updatedAt; not in this shop or not this token: null', async () => {
    const token = await fx.apiToken()
    const e = await webhookService.create(SHOP, input, token.id)
    const changed = await webhookService.update(SHOP, e.id, { active: false }, token.id)
    assert.equal(changed?.active, false)
    assert.equal(changed?.url, input.url)
    assert.ok(changed!.updatedAt.getTime() >= e.updatedAt.getTime())
    assert.equal(await webhookService.update(OTHER_SHOP, e.id, { active: true }, undefined), null)
    assert.equal(await webhookService.update(SHOP, e.id, { active: true }, (await fx.apiToken()).id), null)
    assert.equal(
      (await webhookService.get(SHOP, e.id, undefined))?.active,
      false,
      'nothing changed by the refused ones',
    )
  })

  test('rotating gives a new secret at once, and only for an endpoint the caller can see', async () => {
    const e = await webhookService.create(SHOP, input, undefined)
    const rotated = await webhookService.rotateSecret(SHOP, e.id, undefined)
    assert.match(rotated!.secret, /^whsec_/)
    assert.notEqual(rotated!.secret, e.secret)
    assert.equal((await webhookService.get(SHOP, e.id, undefined))?.secret, rotated!.secret)
    assert.equal(await webhookService.rotateSecret(OTHER_SHOP, e.id, undefined), null)
  })

  test('removing takes its deliveries with it, and only for an endpoint the caller can see', async () => {
    const e = await webhookService.create(SHOP, input, undefined)
    await fx.delivery(e.id)
    assert.equal(await webhookService.remove(OTHER_SHOP, e.id, undefined), null)
    assert.equal((await fx.deliveriesOf(e.id)).length, 1)
    assert.equal((await webhookService.remove(SHOP, e.id, undefined))?.id, e.id)
    assert.equal((await fx.deliveriesOf(e.id)).length, 0)
    assert.equal(await webhookService.remove(SHOP, e.id, undefined), null)
  })
})

describe('test sends and the delivery log', () => {
  test('a test delivery goes to that endpoint only, as webhook.test, whatever it subscribes to', async () => {
    const e = await webhookService.create(SHOP, { ...input, topics: ['product.created'] }, undefined)
    const other = await webhookService.create(SHOP, input, undefined)
    const d = await webhookService.sendTest(SHOP, e.id, undefined)
    assert.equal(d?.topic, 'webhook.test')
    assert.equal(d?.status, 'pending')
    const body = JSON.parse(d!.body) as { type: string; data: { endpointId: string } }
    assert.equal(body.type, 'webhook.test')
    assert.equal(body.data.endpointId, e.id)
    assert.equal((await fx.deliveriesOf(other.id)).length, 0)
    assert.equal(await webhookService.sendTest(OTHER_SHOP, e.id, undefined), null)
  })

  test('listDeliveries pages newest first with the total; an endpoint the caller cannot see is null', async () => {
    const e = await webhookService.create(SHOP, input, undefined)
    const made = []
    for (let i = 0; i < 3; i++) {
      made.push(await fx.delivery(e.id, { createdAt: new Date(Date.now() - (3 - i) * 1000) }))
    }
    const first = await webhookService.listDeliveries(SHOP, { endpointId: e.id, limit: 2, offset: 0 }, undefined)
    assert.equal(first!.total, 3)
    assert.deepEqual(
      first!.items.map((d) => d.id),
      [made[2]!.id, made[1]!.id],
    )
    const rest = await webhookService.listDeliveries(SHOP, { endpointId: e.id, limit: 2, offset: 2 }, undefined)
    assert.deepEqual(
      rest!.items.map((d) => d.id),
      [made[0]!.id],
    )
    assert.equal(
      await webhookService.listDeliveries(OTHER_SHOP, { endpointId: e.id, limit: 2, offset: 0 }, undefined),
      null,
    )
    const token = await fx.apiToken()
    assert.equal(await webhookService.listDeliveries(SHOP, { endpointId: e.id, limit: 2, offset: 0 }, token.id), null)
  })

  test('redeliver puts a finished delivery back to pending, due now, with the same id and body', async () => {
    const e = await webhookService.create(SHOP, input, undefined)
    const d = await fx.delivery(e.id, { status: 'failed', attempts: 8, nextAttemptAt: new Date(Date.now() + 3600_000) })
    const again = await webhookService.redeliver(SHOP, d.id, undefined)
    assert.equal(again?.id, d.id)
    assert.equal(again?.status, 'pending')
    assert.equal(again?.body, d.body)
    const [row] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, d.id))
    assert.ok(row!.nextAttemptAt.getTime() <= Date.now() + 1000, 'due now')
  })

  test('redeliver is refused for another shop’s delivery, or an endpoint the token did not create', async () => {
    const token = await fx.apiToken()
    const e = await webhookService.create(SHOP, input, undefined)
    const d = await fx.delivery(e.id, { status: 'failed' })
    assert.equal(await webhookService.redeliver(OTHER_SHOP, d.id, undefined), null)
    assert.equal(await webhookService.redeliver(SHOP, d.id, token.id), null)
    assert.equal((await fx.deliveryById(d.id))?.status, 'failed')
  })
})
