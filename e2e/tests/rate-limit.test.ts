// The shared rate limiter behind the login-code limits (takeRate, counters in the rate_limits table). It talks to the
// database directly, so the point it proves is the one memory counters can't: every process sees the same count, and
// callers racing for the last slot can't both get it.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, describe, test } from 'node:test'
import { eq, like } from 'drizzle-orm'
import { takeRate } from '@shopnex/auth'
import { db, schema } from '@shopnex/db'
import { closeDb } from '../lib'

const run = Date.now().toString(36)
const used: string[] = []
const key = (name: string) => {
  const k = `e2e-rate:${run}:${name}`
  used.push(k)
  return k
}
const hashed = (k: string) => createHash('sha256').update(k).digest('hex')
const row = async (k: string) =>
  (
    await db
      .select()
      .from(schema.rateLimits)
      .where(eq(schema.rateLimits.key, hashed(k)))
  )[0]

after(async () => {
  for (const k of used) await db.delete(schema.rateLimits).where(eq(schema.rateLimits.key, hashed(k)))
  await closeDb()
})

describe('takeRate', () => {
  test('lets uses through up to the cap, then says how long to wait', async () => {
    const k = key('cap')
    const answers = []
    for (let i = 0; i < 5; i++) answers.push(await takeRate(k, 3, 60_000))
    assert.deepEqual(answers.slice(0, 3), [null, null, null], 'the first three are within the cap')
    for (const wait of answers.slice(3)) {
      assert.ok(typeof wait === 'number' && wait >= 1 && wait <= 60, `wait ${wait}s is within the window`)
    }
  })

  test('callers racing for the last slots cannot all get one', async () => {
    const k = key('race')
    const answers = await Promise.all(Array.from({ length: 25 }, () => takeRate(k, 5, 60_000)))
    assert.equal(answers.filter((a) => a === null).length, 5, 'exactly the cap is let through, not more')
    assert.equal((await row(k))!.count, 25, 'and every use was counted')
  })

  test('keys are independent', async () => {
    const [a, b] = [key('a'), key('b')]
    assert.equal(await takeRate(a, 1, 60_000), null)
    assert.notEqual(await takeRate(a, 1, 60_000), null)
    assert.equal(await takeRate(b, 1, 60_000), null, 'b still has its whole allowance')
  })

  test('the window ends on its own and the allowance starts again', async () => {
    const k = key('window')
    assert.equal(await takeRate(k, 1, 1_000), null)
    assert.notEqual(await takeRate(k, 1, 1_000), null)
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    assert.equal(await takeRate(k, 1, 1_000), null, 'a new window')
    assert.equal((await row(k))!.count, 1, 'counting from one again')
  })

  test('uses past the cap never extend the window', async () => {
    const k = key('no-extend')
    assert.equal(await takeRate(k, 1, 5_000), null)
    const first = await takeRate(k, 1, 5_000)
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    for (let i = 0; i < 5; i++) await takeRate(k, 1, 5_000)
    const later = await takeRate(k, 1, 5_000)
    assert.ok(typeof first === 'number' && typeof later === 'number')
    assert.ok(later < first, `hammering the limit does not push it back (${first}s, then ${later}s)`)
  })

  test('only a hash of the key is stored: no email address or visitor address', async () => {
    const email = `someone-${run}@example.com`
    const k = `e2e-rate:${run}:${email}:203.0.113.9`
    used.push(k)
    await takeRate(k, 5, 60_000)
    assert.ok(await row(k), 'stored under the hash')
    const leaks = await db
      .select()
      .from(schema.rateLimits)
      .where(like(schema.rateLimits.key, `%${run}%`))
    assert.deepEqual(leaks, [], 'no row is keyed by anything readable that contains the email or address')
    assert.match(hashed(k), /^[0-9a-f]{64}$/)
  })
})
