// Customer accounts over HTTP: sign in with a code emailed through the shop's SMTP (a tiny SMTP server in this
// process), see your orders (guest orders with the same email included), sign out. The shop's email settings are
// put back as they were afterwards.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import { takeRate } from '@shopnex/auth'
import { db, schema } from '@shopnex/db'
import { emailService } from '@shopnex/email'
import { orderService } from '@shopnex/orders'
import { Fixtures, PASSWORD, SHOP, authCall, call, closeDb, ok, sellableVariants } from '../lib'
import { smtpSink } from '../smtp-sink'

const fx = new Fixtures()
const sink = smtpSink()
let variant: { id: string; priceCents: number }
let settingsBefore: (typeof schema.emailSettings.$inferSelect)[]

const TOKEN = 'x-shopnex-customer-token'
const as = (token: string) => ({ [TOKEN]: token })

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

async function placeOrder(email: string) {
  const order = await orderService.create(SHOP, {
    email,
    name: 'Ada Tester',
    items: [{ variantId: variant.id, quantity: 1 }],
    shippingAddress: address,
    payment: { gateway: 'manual', name: 'Bank transfer', instructions: 'IBAN 123' },
  })
  fx.order(order.id)
  return order
}

const mailsTo = (email: string) =>
  sink.messages.filter((m) => m.toLowerCase().includes(`to: ${email}`) || m.includes(`<${email}>`))

// The code in the subject of the newest message to `email`
async function codeSentTo(email: string) {
  for (let i = 0; i < 50; i++) {
    const message = [...sink.messages]
      .reverse()
      .find((m) => m.toLowerCase().includes(`to: ${email}`) || m.includes(`<${email}>`))
    const code = message?.match(/^Subject: (\d{6}) is your/im)?.[1]
    if (code) return code
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.fail(`no code was emailed to ${email}`)
}

const requestCode = (email: string) => call('POST', '/storefront/customer/code', { email })
const signIn = (email: string, code: string) => call('POST', '/storefront/customer/sign-in', { email, code })

// The limits live in the rate_limits table under a hash of their key (see accounts.ts): the test finds its rows by it
const limitRow = (key: string) => eq(schema.rateLimits.key, createHash('sha256').update(key).digest('hex'))
const touched = new Set<string>()
/** A visitor's or mailbox's limit rows are removed after the run: the keys of everything a test asks about */
const watch = (...keys: string[]) => keys.forEach((k) => touched.add(k))
const person = (label = 'shopper') => {
  const email = fx.shopper(label)
  watch(`login-code:email:${SHOP}:${email}`, `login-check:email:${SHOP}:${email}`)
  return email
}
const clearLimits = async () => {
  for (const key of touched) await db.delete(schema.rateLimits).where(limitRow(key))
  touched.clear()
}
const fromIp = (ip: string) => ({ 'x-forwarded-for': ip })
// A visitor address of its own, from the IPv6 documentation range with 32 random bits: never one a past run used
const visitor = () => `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`

before(async () => {
  watch(`login-code:shop:${SHOP}`)
  await clearLimits() // a full allowance, whatever ran in the last 15 minutes
  watch(`login-code:shop:${SHOP}`)
  await fx.init()
  ;[variant] = (await sellableVariants(1)) as [typeof variant]
  settingsBefore = await db.select().from(schema.emailSettings).where(eq(schema.emailSettings.shopId, SHOP))
  await db.delete(schema.emailSettings).where(eq(schema.emailSettings.shopId, SHOP))
})

after(async () => {
  await clearLimits()
  await sink.stop()
  await db.delete(schema.emailSettings).where(eq(schema.emailSettings.shopId, SHOP))
  if (settingsBefore.length) await db.insert(schema.emailSettings).values(settingsBefore)
  await fx.cleanup()
  await closeDb()
})

describe('customer accounts', () => {
  test('without email set up, signing in is unavailable', async () => {
    const r = await requestCode(person('off'))
    assert.equal(r.status, 503, JSON.stringify(r.body))
    assert.equal(r.body.code, 'CUSTOMER_LOGIN_UNAVAILABLE')
  })

  describe('with email on', () => {
    before(async () => {
      const port = await sink.start()
      await emailService.useSmtp(SHOP, {
        preset: 'other',
        host: '127.0.0.1',
        port,
        username: '',
        fromName: 'E2E Shop',
        fromEmail: 'shop@e2e.test',
      })
    })

    test('a guest signs in with the code and finds the order they placed before', async () => {
      const email = person()
      const guestOrder = await placeOrder(email)
      const [guest] = await db.select().from(schema.customers).where(eq(schema.customers.email, email))
      assert.equal(guest?.userId, null, 'a guest has no login yet')

      ok(await requestCode(email))
      const code = await codeSentTo(email)
      const wrong = code === '000000' ? '111111' : '000000'
      const bad = await signIn(email, wrong)
      assert.equal(bad.status, 400)
      assert.equal(bad.body.code, 'INVALID_CODE')

      const { token, customer } = ok(await signIn(email, code))
      assert.ok(token)
      assert.equal(customer.email, email)
      assert.equal(customer.id, guest!.id, 'the guest customer record is the account')
      const [linked] = await db.select().from(schema.customers).where(eq(schema.customers.id, guest!.id))
      assert.ok(linked?.userId)

      const reused = await signIn(email, code)
      assert.equal(reused.status, 400, 'a code works once')

      assert.equal(ok(await call('GET', '/storefront/customer', undefined, as(token))).email, email)
      const orders = ok(await call('GET', '/storefront/customer/orders', undefined, as(token)))
      assert.deepEqual(
        orders.nodes.map((o: { id: string }) => o.id),
        [guestOrder.id],
      )
      const detail = ok(await call('GET', `/storefront/customer/orders/${guestOrder.id}`, undefined, as(token)))
      assert.equal(detail.orderNumber, guestOrder.orderNumber)
      assert.equal(detail.lines.length, 1)
      assert.equal(detail.paymentInstructions, 'IBAN 123')
      assert.equal(detail.shippingAddress.city, 'Somewhere')

      // The token is a customer's only: nothing in the admin API
      const admin = await call('GET', '/admin/orders', undefined, { authorization: `Bearer ${token}` })
      assert.ok([401, 403].includes(admin.status), `admin API answered ${admin.status}`)
      const [member] = await db
        .select()
        .from(schema.shopMembers)
        .innerJoin(schema.user, eq(schema.user.id, schema.shopMembers.userId))
        .where(and(eq(schema.shopMembers.organizationId, SHOP), eq(schema.user.email, email)))
      assert.equal(member, undefined, 'a customer is not a shop member')

      ok(await call('POST', '/storefront/customer/sign-out', undefined, as(token)))
      const after = await call('GET', '/storefront/customer', undefined, as(token))
      assert.equal(after.status, 401)
      assert.equal(after.body.code, 'UNAUTHORIZED')
    })

    test('a new customer gets an account on first sign-in, and sees only their own orders', async () => {
      const [alice, bob] = [person('alice'), person('bob')]
      const bobsOrder = await placeOrder(bob)
      ok(await requestCode(alice))
      const aliceSession = ok(await signIn(alice, await codeSentTo(alice)))
      assert.equal(
        ok(await call('GET', '/storefront/customer/orders', undefined, as(aliceSession.token))).nodes.length,
        0,
      )
      const peek = await call('GET', `/storefront/customer/orders/${bobsOrder.id}`, undefined, as(aliceSession.token))
      assert.equal(peek.status, 404)

      const renamed = ok(
        await call('PATCH', '/storefront/customer', { name: 'Alice A', phone: null }, as(aliceSession.token)),
      )
      assert.equal(renamed.name, 'Alice A')
    })

    test('requests without a valid token are unauthorized', async () => {
      for (const token of [undefined, 'nonsense']) {
        const headers = token ? as(token) : {}
        for (const path of ['/storefront/customer', '/storefront/customer/orders']) {
          const r = await call('GET', path, undefined, headers)
          assert.equal(r.status, 401, `${path} with ${token}`)
        }
      }
    })

    test("a staff member's account is left alone: no code, and their password still works", async () => {
      const staff = await fx.account('member')
      ok(await requestCode(staff.email))
      await new Promise((resolve) => setTimeout(resolve, 300))
      assert.equal(mailsTo(staff.email).length, 0, 'no email is sent')
      assert.equal((await signIn(staff.email, '123456')).status, 400)
      const login = await authCall('/sign-in/email', { email: staff.email, password: PASSWORD })
      assert.equal(login.status, 200, 'the password was not wiped')
    })

    test("Better Auth's own sign-in endpoints can't be used to send mail or create accounts", async () => {
      const email = person('direct')
      await authCall('/email-otp/send-verification-otp', { email, type: 'sign-in' })
      await new Promise((resolve) => setTimeout(resolve, 300))
      assert.equal(mailsTo(email).length, 0)
      const direct = await authCall('/sign-in/email-otp', { email, otp: '123456' })
      assert.notEqual(direct.status, 200)
    })

    test('an existing customer cannot turn a code into a Better Auth session cookie', async () => {
      const email = person('cookie')
      ok(await requestCode(email))
      ok(await signIn(email, await codeSentTo(email))) // the account now exists
      ok(await requestCode(email))
      const code = await codeSentTo(email)
      // Straight to Better Auth, skipping the storefront: a cookie here would reach the admin's own session APIs
      const direct = await authCall('/sign-in/email-otp', { email, otp: code })
      assert.notEqual(direct.status, 200, JSON.stringify(direct.body))
      assert.equal(direct.cookie, undefined, 'no session cookie')
      // The code was not used up by the refused attempt
      ok(await signIn(email, code))
    })

    test('asking for codes over and over is limited', async () => {
      const email = person('spam')
      const statuses: number[] = []
      for (let i = 0; i < 6; i++) statuses.push((await requestCode(email)).status)
      assert.deepEqual(statuses.slice(0, 4), [200, 200, 200, 200])
      assert.equal(statuses.at(-1), 429)
    })

    describe('limits shared through the database', () => {
      test('one visitor cannot send codes to many people', async () => {
        const ip = visitor()
        watch(`login-code:ip:${SHOP}:${ip}`)
        const statuses: number[] = []
        for (let i = 0; i < 22; i++) {
          statuses.push(
            (await call('POST', '/storefront/customer/code', { email: person(`ip${i}`) }, fromIp(ip))).status,
          )
        }
        assert.deepEqual(statuses.slice(0, 20), Array(20).fill(200), 'twenty different people, all within the cap')
        assert.deepEqual(statuses.slice(20), [429, 429])
        // Somebody else, from another address, is not affected
        const otherIp = visitor()
        watch(`login-code:ip:${SHOP}:${otherIp}`)
        assert.equal(
          (await call('POST', '/storefront/customer/code', { email: person('other-ip') }, fromIp(otherIp))).status,
          200,
        )
      })

      test('a count made by another process is honoured: the limit is not held in memory', async () => {
        const email = person('shared')
        // This test process stands in for a second server replica that already used up this mailbox's allowance
        const key = `login-code:email:${SHOP}:${email}`
        for (let i = 0; i < 4; i++) assert.equal(await takeRate(key, 4, 15 * 60_000), null)

        const r = await requestCode(email)
        assert.equal(r.status, 429, JSON.stringify(r.body))
        assert.equal(r.body.code, 'TOO_MANY_REQUESTS')
        assert.equal(mailsTo(email).length, 0, 'and no mail was sent')
      })

      test('trying codes over and over is limited per mailbox, even for wrong ones', async () => {
        const email = person('guess')
        const statuses: number[] = []
        for (let i = 0; i < 12; i++) statuses.push((await signIn(email, String(100000 + i))).status)
        assert.deepEqual(statuses.slice(0, 10), Array(10).fill(400), 'ten wrong guesses are just wrong')
        assert.deepEqual(statuses.slice(10), [429, 429])
        const blocked = await signIn(email, '123456')
        assert.equal(blocked.body.code, 'TOO_MANY_REQUESTS')
      })

      test('one visitor cannot check codes for many people', async () => {
        const ip = visitor()
        watch(`login-check:ip:${SHOP}:${ip}`)
        const statuses: number[] = []
        for (let i = 0; i < 32; i++) {
          statuses.push(
            (
              await call(
                'POST',
                '/storefront/customer/sign-in',
                { email: person(`chk${i}`), code: '111111' },
                fromIp(ip),
              )
            ).status,
          )
        }
        assert.deepEqual(statuses.slice(0, 30), Array(30).fill(400))
        assert.deepEqual(statuses.slice(30), [429, 429])
      })

      test('a right code still works while the limit has room', async () => {
        const email = person('works')
        ok(await requestCode(email))
        const code = await codeSentTo(email)
        assert.equal((await signIn(email, '000000')).status, 400)
        ok(await signIn(email, code))
      })

      test('nothing readable is kept: the table has no email address or visitor address in it', async () => {
        const email = person('private')
        const privateIp = visitor()
        watch(`login-code:ip:${SHOP}:${privateIp}`)
        ok(await call('POST', '/storefront/customer/code', { email }, fromIp(privateIp)))
        const rows = await db.select().from(schema.rateLimits)
        const readable = rows.filter(
          (r) => r.key.includes('@') || r.key.includes('2001:db8:') || !/^[0-9a-f]{64}$/.test(r.key),
        )
        assert.deepEqual(readable, [], 'every key is a 64-character hash')
      })
    })
  })
})
