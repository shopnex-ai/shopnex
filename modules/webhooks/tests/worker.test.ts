// The delivery worker: what it sends and how it signs it, what counts as success, the retry schedule, and what it refuses to call.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'

const { db, webhookDeliveries } = fx
const { processDue: processDueIn, RETRY_DELAYS_S } = await import('../src/worker')
const processDue = (opts: Parameters<typeof processDueIn>[0]) => processDueIn(opts, db)
const { eq } = await import('drizzle-orm')

const open = { allowPrivateNetworks: true }

before(async () => {
  await fx.prepareDatabase()
  await fx.startReceiver()
})
beforeEach(async () => {
  await fx.cleanup()
  fx.resetReceiver()
})
after(async () => {
  await fx.cleanup()
  await fx.stopReceiver()
})

const secretBytes = (secret: string) => Buffer.from(secret.slice('whsec_'.length), 'base64')

describe('a delivery that succeeds', () => {
  test('is posted as signed JSON, once, and marked succeeded with the answer’s status', async () => {
    const e = await fx.endpoint()
    const d = await fx.delivery(e.id)
    assert.equal(await processDue(open), 1)

    const [call] = fx.received
    assert.equal(call!.path, '/hook')
    assert.equal(call!.body, d.body, 'the exact bytes that were stored')
    assert.equal(call!.headers['webhook-id'], d.id)
    assert.equal(call!.headers['content-type'], 'application/json')
    const timestamp = call!.headers['webhook-timestamp'] as string
    const expected =
      'v1,' + createHmac('sha256', secretBytes(e.secret)).update(`${d.id}.${timestamp}.${d.body}`).digest('base64')
    assert.equal(call!.headers['webhook-signature'], expected)

    const row = await fx.deliveryById(d.id)
    assert.equal(row!.status, 'succeeded')
    assert.equal(row!.attempts, 1)
    assert.equal(row!.responseStatus, 200)
    assert.equal(row!.lastError, null)
    assert.ok(row!.lastAttemptAt)
    assert.equal(await processDue(open), 0, 'a finished delivery is not sent again')
  })

  test('only what is due is sent', async () => {
    const e = await fx.endpoint()
    await fx.delivery(e.id, { nextAttemptAt: new Date(Date.now() + 3600_000) })
    assert.equal(await processDue(open), 0)
    assert.equal(fx.received.length, 0)
  })

  test('at most 20 at a time', async () => {
    const e = await fx.endpoint()
    for (let i = 0; i < 25; i++) await fx.delivery(e.id)
    assert.equal(await processDue(open), 20)
    assert.equal(await processDue(open), 5)
  })

  test('the instance’s own signature is added next to the endpoint’s, with its key id and instance', async () => {
    const e = await fx.endpoint()
    const d = await fx.delivery(e.id)
    const messages: string[] = []
    await processDue({
      ...open,
      instanceSignature: (message) => {
        messages.push(message)
        return Promise.resolve({ signature: 'SIG', kid: 'key-1', instance: 'https://shop.example' })
      },
    })
    const headers = fx.received[0]!.headers
    assert.match(headers['webhook-signature'] as string, /^v1,\S+ v1a,SIG$/)
    assert.equal(headers['shopnex-instance'], 'https://shop.example')
    assert.equal(headers['shopnex-key-id'], 'key-1')
    assert.equal(messages[0], `${d.id}.${headers['webhook-timestamp'] as string}.${d.body}`)
  })

  test('the address can be rewritten for the server (an app’s internal address)', async () => {
    const e = await fx.endpoint({ url: 'http://app.internal.invalid/hook' })
    const d = await fx.delivery(e.id)
    await processDue({ ...open, resolveUrl: () => `${fx.receiverUrl}/rewritten` })
    assert.equal(fx.received[0]!.path, '/rewritten')
    assert.equal((await fx.deliveryById(d.id))!.status, 'succeeded')
  })
})

describe('a delivery that fails', () => {
  test('is tried again in a minute, keeping the start of the answer as the error', async () => {
    const e = await fx.endpoint()
    const d = await fx.delivery(e.id)
    fx.behavior.status = 500
    fx.behavior.body = 'x'.repeat(2000)
    await processDue(open)
    const row = await fx.deliveryById(d.id)
    assert.equal(row!.status, 'pending')
    assert.equal(row!.attempts, 1)
    assert.equal(row!.responseStatus, 500)
    assert.equal(row!.lastError, 'x'.repeat(1000))
    const wait = row!.nextAttemptAt.getTime() - row!.lastAttemptAt!.getTime()
    assert.ok(Math.abs(wait - RETRY_DELAYS_S[0]! * 1000) < 2000, `waits about ${RETRY_DELAYS_S[0]}s, waited ${wait}ms`)
    assert.equal(await processDue(open), 0, 'not before then')
  })

  test('the schedule is 1 min, 5 min, 30 min, 2 h, 5 h, 8 h, 8 h, and the 8th failure is final', async () => {
    assert.deepEqual(RETRY_DELAYS_S, [60, 300, 1800, 7200, 18000, 28800, 28800])
    const e = await fx.endpoint()
    const d = await fx.delivery(e.id, { attempts: 6 })
    fx.behavior.status = 502
    await processDue(open)
    const seventh = await fx.deliveryById(d.id)
    assert.equal(seventh!.status, 'pending')
    assert.equal(seventh!.attempts, 7)
    await db
      .update(webhookDeliveries)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(webhookDeliveries.id, d.id))
    await processDue(open)
    const eighth = await fx.deliveryById(d.id)
    assert.equal(eighth!.status, 'failed')
    assert.equal(eighth!.attempts, 8)
  })

  test('a redirect is not a success and is not followed', async () => {
    const e = await fx.endpoint()
    const d = await fx.delivery(e.id)
    fx.behavior.status = 302
    fx.behavior.location = `${fx.receiverUrl}/elsewhere`
    fx.behavior.body = ''
    await processDue(open)
    assert.deepEqual(
      fx.received.map((r) => r.path),
      ['/hook'],
    )
    const row = await fx.deliveryById(d.id)
    assert.equal(row!.status, 'pending')
    assert.equal(row!.responseStatus, 302)
  })

  test('an endpoint that is off is failed at once, without a request', async () => {
    const e = await fx.endpoint({ active: false })
    const d = await fx.delivery(e.id)
    await processDue(open)
    assert.equal(fx.received.length, 0)
    const row = await fx.deliveryById(d.id)
    assert.equal(row!.status, 'failed')
    assert.equal(row!.lastError, 'Endpoint disabled')
  })

  test('an address nobody answers on is an error with a reason, and a retry', async () => {
    const e = await fx.endpoint({ url: 'http://127.0.0.1:1/hook' })
    const d = await fx.delivery(e.id)
    await processDue(open)
    const row = await fx.deliveryById(d.id)
    assert.equal(row!.status, 'pending')
    assert.equal(row!.responseStatus, null)
    assert.ok(row!.lastError)
  })
})

describe('the private network', () => {
  test('is refused unless allowed: no request is made, and it is retried like any failure', async () => {
    const e = await fx.endpoint()
    const d = await fx.delivery(e.id)
    await processDue({ allowPrivateNetworks: false })
    assert.equal(fx.received.length, 0)
    const row = await fx.deliveryById(d.id)
    assert.equal(row!.status, 'pending')
    assert.match(row!.lastError ?? '', /private network address/)
  })
})
