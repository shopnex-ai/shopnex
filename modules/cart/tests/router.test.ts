// The admin shipping and carrier service routes, called through the real router with fake resolvers and an in-memory database: who may
// call them (owners and admins for the settings, a carrier app's own token for registering), input checks, and what they answer.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { ORPCError, call } from '@orpc/server'
import { apps } from '@shopnex/core/schema'
import { hasScope } from '@shopnex/core/scopes'
import type { ApiScope } from '@shopnex/core/schema'
import * as fx from './fixtures'

const { db, SHOP } = fx
const { configureRpc } = await import('@shopnex/rpc')
const { cartModule } = await import('../src/cart.module')

const { shippingRates, carrierServices, carrierServicesApp } = cartModule.router
const shop = { id: SHOP, storefrontUrl: null } as never

let who: 'owner' | 'member' | 'nobody' | { token: ApiScope[]; appId: string | null } = 'owner'

before(async () => {
  await fx.prepareDatabase()
  configureRpc({
    session: () =>
      Promise.resolve(
        who === 'owner' || who === 'member'
          ? ({ session: { activeOrganizationId: SHOP }, user: { id: 'u1', email: 'staff@example.test' } } as never)
          : null,
      ),
    adminShop: () => Promise.resolve({ shop, role: who === 'member' ? 'member' : 'owner', superAdmin: false } as never),
    token: () =>
      Promise.resolve(
        typeof who === 'object' ? ({ shop, token: { scopes: who.token, appId: who.appId } } as never) : null,
      ),
    hasScope,
  })
})
beforeEach(async () => {
  who = 'owner'
  await fx.cleanup()
})
after(fx.cleanup)

const run = <T>(procedure: unknown, input?: unknown) =>
  call(procedure as Parameters<typeof call>[0], input, {
    context: { headers: new Headers(typeof who === 'object' ? { authorization: 'Bearer sk_test' } : {}) },
  } as never) as Promise<T>
const refused = (code: string) => (e: unknown) => e instanceof ORPCError && e.code === code
// Refused by the route's own input check, before any service runs
const invalid = (e: unknown) =>
  e instanceof ORPCError && e.code === 'BAD_REQUEST' && e.message === 'Input validation failed'
const MISSING = '00000000-0000-4000-8000-000000000000'

type Rate = { id: string; name: string; priceCents: number; freeAboveCents: number | null; active: boolean }

describe('Settings → Shipping: who may call', () => {
  test('owners and admins; nobody signed in is UNAUTHORIZED, a plain member and an API token are refused', async () => {
    who = 'nobody'
    await assert.rejects(run(shippingRates.list), refused('UNAUTHORIZED'))
    who = { token: ['write_shipping'], appId: null }
    await assert.rejects(run(shippingRates.list), refused('UNAUTHORIZED'))
    who = 'member'
    await assert.rejects(run(shippingRates.list), refused('FORBIDDEN'))
    await assert.rejects(run(shippingRates.create, { name: 'x', priceCents: 1 }), refused('FORBIDDEN'))
    who = 'owner'
    assert.deepEqual(await run(shippingRates.list), [])
  })
})

describe('Settings → Shipping: the flat rates', () => {
  test('create, list, update (partial) and delete answer the rate', async () => {
    const r = await run<Rate>(shippingRates.create, { name: '  Standard ', priceCents: 599, freeAboveCents: 5000 })
    assert.deepEqual([r.name, r.priceCents, r.freeAboveCents, r.active], ['Standard', 599, 5000, true])
    const u = await run<Rate>(shippingRates.update, { id: r.id, priceCents: 700, active: false })
    assert.deepEqual([u.name, u.priceCents, u.freeAboveCents, u.active], ['Standard', 700, 5000, false])
    assert.equal((await run<Rate[]>(shippingRates.list)).length, 1)
    assert.equal((await run<Rate>(shippingRates.delete, { id: r.id })).id, r.id)
    assert.deepEqual(await run(shippingRates.list), [])
  })

  test('an unknown rate is NOT_FOUND', async () => {
    await assert.rejects(run(shippingRates.update, { id: MISSING, name: 'x' }), refused('NOT_FOUND'))
    await assert.rejects(run(shippingRates.delete, { id: MISSING }), refused('NOT_FOUND'))
  })

  test('input is checked: a blank or long name, a negative or fractional price, a negative threshold', async () => {
    for (const bad of [
      { name: '   ', priceCents: 1 },
      { name: 'x'.repeat(101), priceCents: 1 },
      { name: 'x', priceCents: -1 },
      { name: 'x', priceCents: 1.5 },
      { name: 'x', priceCents: 1, freeAboveCents: -5 },
      { priceCents: 1 },
    ])
      await assert.rejects(run(shippingRates.create, bad), invalid, JSON.stringify(bad))
    await assert.rejects(run(shippingRates.update, { id: 'not-a-uuid', name: 'x' }), invalid)
  })
})

describe('carrier apps registering their service', () => {
  async function carrier() {
    const [app] = await db
      .insert(apps)
      .values({
        name: 'Carrier',
        appUrl: 'http://127.0.0.1:9/app',
        redirectUrls: [],
        scopes: ['write_shipping'],
        clientId: `app_r_${fx.unique()}`,
      })
      .returning()
    fx.trackApp(app!.id)
    return app!
  }
  const body = { name: 'Carrier', ratesUrl: 'http://127.0.0.1:9/rates', ready: true }

  test('only a carrier app’s own token: nobody signed in, staff, a token without an app and a token without write_shipping are refused', async () => {
    const app = await carrier()
    who = 'nobody'
    await assert.rejects(run(carrierServicesApp.configure, body), refused('UNAUTHORIZED'))
    who = { token: ['write_shipping'], appId: null }
    await assert.rejects(run(carrierServicesApp.configure, body), refused('FORBIDDEN'))
    who = { token: ['write_orders'], appId: app.id }
    await assert.rejects(run(carrierServicesApp.configure, body), refused('FORBIDDEN'))
    who = 'owner'
    await assert.rejects(run(carrierServicesApp.configure, body), refused('FORBIDDEN'), 'staff are not apps')
  })

  test('registers the service, answers what staff see of it, and again updates the same one', async () => {
    const app = await carrier()
    who = { token: ['write_shipping'], appId: app.id }
    const s = await run<{ id: string; appId: string; name: string; active: boolean; ready: boolean }>(
      carrierServicesApp.configure,
      body,
    )
    assert.deepEqual([s.appId, s.name, s.active, s.ready], [app.id, 'Carrier', true, true])
    assert.deepEqual(Object.keys(s).sort(), ['active', 'appId', 'id', 'name', 'ready'], 'the rates URL is not shown')
    const again = await run<typeof s>(carrierServicesApp.configure, { ...body, ready: false })
    assert.deepEqual([again.id, again.ready], [s.id, false])
  })

  test('a rates URL off the app’s origin is BAD_REQUEST; one that is not a URL, or is not http(s), is refused by the input check', async () => {
    const app = await carrier()
    who = { token: ['write_shipping'], appId: app.id }
    await assert.rejects(
      run(carrierServicesApp.configure, { ...body, ratesUrl: 'https://evil.example.com/rates' }),
      refused('BAD_REQUEST'),
    )
    for (const ratesUrl of ['nope', 'ftp://127.0.0.1/rates', ''])
      await assert.rejects(run(carrierServicesApp.configure, { ...body, ratesUrl }), invalid, ratesUrl)
    await assert.rejects(run(carrierServicesApp.configure, { ...body, name: '' }), invalid)
  })
})

describe('Settings → Shipping: the carrier services', () => {
  test('staff see the services, rename or switch them off, and the available apps with this instance’s URL', async () => {
    const [app] = await db
      .insert(apps)
      .values({
        name: 'Carrier',
        appUrl: 'http://127.0.0.1:9/app',
        redirectUrls: [],
        scopes: ['write_shipping'],
        clientId: `app_s_${fx.unique()}`,
      })
      .returning()
    fx.trackApp(app!.id)
    const available = await run<{ instanceUrl: string; apps: { id: string }[] }>(carrierServices.available)
    assert.equal(available.instanceUrl, 'http://localhost:3000')
    assert.ok(available.apps.some((a) => a.id === app!.id))
    who = { token: ['write_shipping'], appId: app!.id }
    const s = await run<{ id: string }>(carrierServicesApp.configure, {
      name: 'Carrier',
      ratesUrl: 'http://127.0.0.1:9/rates',
      ready: true,
    })
    who = 'owner'
    assert.deepEqual(
      (await run<{ name: string }[]>(carrierServices.list)).map((x) => x.name),
      ['Carrier'],
    )
    const renamed = await run<{ name: string; active: boolean }>(carrierServices.update, {
      id: s.id,
      name: 'Express',
      active: false,
    })
    assert.deepEqual([renamed.name, renamed.active], ['Express', false])
    await assert.rejects(run(carrierServices.update, { id: MISSING, name: 'x' }), refused('NOT_FOUND'))
    await assert.rejects(run(carrierServices.update, { id: s.id, name: '' }), invalid)
    who = 'member'
    await assert.rejects(run(carrierServices.list), refused('FORBIDDEN'))
  })
})
