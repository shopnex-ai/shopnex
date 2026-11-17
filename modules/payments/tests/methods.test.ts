// The payment method a payments app registers in a shop (what Settings → Payments shows), and the list of apps a shop can still install.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { appInstallations } from '@shopnex/apps/schema'
import { apps } from '@shopnex/core/schema'

const fx = await import('./fixtures')
const { db, schema, SHOP } = fx
const { paymentMethods } = await import('../src/payments.schema')
const { bindConn } = await import('@shopnex/kit')
const methods = bindConn(await import('../src/methods'), db)
const { PaymentError } = await import('../src/payments.errors')
const { and, eq } = await import('drizzle-orm')

const refused = (code: string) => (e: unknown) => e instanceof PaymentError && e.code === code
let n = 0
const bareApp = async (patch: Partial<typeof apps.$inferInsert> = {}) =>
  (
    await db
      .insert(apps)
      .values({
        name: `App ${++n}`,
        appUrl: fx.appUrl,
        redirectUrls: [],
        scopes: ['write_payment_sessions'],
        clientId: `bare-${Date.now()}-${n}`,
        ...patch,
      })
      .returning()
  )[0]!
const input = (patch: Partial<Parameters<typeof methods.configure>[2]> = {}) => ({
  name: 'Credit card',
  gateway: 'fakepay',
  paymentSessionUrl: `${fx.appUrl}/pay`,
  refundSessionUrl: `${fx.appUrl}/refund`,
  ready: true,
  ...patch,
})
const methodsOf = (appId: string) =>
  db
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.shopId, SHOP), eq(paymentMethods.appId, appId)))

before(async () => {
  await fx.prepareDatabase()
  await fx.startFakeApp()
})
beforeEach(fx.cleanup)
after(async () => {
  await fx.cleanup()
  await fx.stopFakeApp()
})

describe('configure', () => {
  test('registers the app’s method in the shop, named as the app says, first in the list', async () => {
    const app = await bareApp()
    const method = await methods.configure(SHOP, app.id, input())
    assert.equal(method.provider, 'app')
    assert.equal(method.name, 'Credit card')
    assert.equal(method.gateway, 'fakepay')
    assert.equal(method.appId, app.id)
    assert.equal(method.ready, true)
    assert.equal(method.active, true)
    assert.equal(method.paymentSessionUrl, `${fx.appUrl}/pay`)
    assert.equal(method.refundSessionUrl, `${fx.appUrl}/refund`)
  })

  test('a new method goes before the ones already there: most buyers pay by card', async () => {
    const [existing] = await db
      .insert(paymentMethods)
      .values({ shopId: SHOP, provider: 'manual', name: 'Bank transfer', position: 3 })
      .returning()
    const app = await bareApp()
    const method = await methods.configure(SHOP, app.id, input())
    assert.ok(method.position < existing!.position)
    const second = await methods.configure(SHOP, (await bareApp()).id, input({ name: 'Wallet' }))
    assert.ok(second.position < method.position)
  })

  test('configuring again updates the URLs, gateway and readiness, and keeps what staff chose', async () => {
    const app = await bareApp()
    const first = await methods.configure(SHOP, app.id, input({ ready: false }))
    await db
      .update(paymentMethods)
      .set({ name: 'Pay by card', active: false, position: 7 })
      .where(eq(paymentMethods.id, first.id))
    const again = await methods.configure(
      SHOP,
      app.id,
      input({ name: 'Ignored', gateway: 'newpay', ready: true, paymentSessionUrl: `${fx.appUrl}/pay2` }),
    )
    assert.equal(again.id, first.id)
    assert.equal(again.name, 'Pay by card')
    assert.equal(again.active, false)
    assert.equal(again.position, 7)
    assert.equal(again.gateway, 'newpay')
    assert.equal(again.ready, true)
    assert.equal(again.paymentSessionUrl, `${fx.appUrl}/pay2`)
    assert.equal((await methodsOf(app.id)).length, 1)
  })

  test('both session URLs must be on the app’s own origin, so an app cannot point ShopNex at someone else’s server', async () => {
    const app = await bareApp()
    for (const patch of [
      { paymentSessionUrl: 'https://evil.example/pay' },
      { refundSessionUrl: 'https://evil.example/refund' },
      { paymentSessionUrl: `${fx.appUrl.replace('127.0.0.1', 'localhost')}/pay` },
      { paymentSessionUrl: 'not a url' },
    ]) {
      await assert.rejects(methods.configure(SHOP, app.id, input(patch)), refused('INVALID_SESSION_URL'))
    }
    assert.equal((await methodsOf(app.id)).length, 0)
  })

  test('only an app that exists can configure a method', async () => {
    await assert.rejects(
      methods.configure(SHOP, '00000000-0000-4000-8000-000000000000', input()),
      refused('NOT_A_PAYMENTS_APP'),
    )
  })
})

describe('availableApps', () => {
  test('lists the apps that can take payments and are not installed in this shop yet', async () => {
    const free = await bareApp({ name: 'Free app' })
    const installed = await bareApp({ name: 'Installed app' })
    const delisted = await bareApp({ name: 'Delisted app', delistedAt: new Date() })
    const noScope = await bareApp({ name: 'No scope', scopes: ['read_products'] })
    const reinstallable = await bareApp({ name: 'Was uninstalled' })
    await db.insert(appInstallations).values({ appId: installed.id, shopId: SHOP, scopes: ['write_payment_sessions'] })
    await db
      .insert(appInstallations)
      .values({ appId: reinstallable.id, shopId: SHOP, scopes: ['write_payment_sessions'], uninstalledAt: new Date() })

    const names = (await methods.availableApps(SHOP)).map((a) => a.name)
    assert.ok(names.includes(free.name))
    assert.ok(names.includes(reinstallable.name), 'an uninstalled app can be installed again')
    for (const hidden of [installed, delisted, noScope]) assert.ok(!names.includes(hidden.name), hidden.name)
  })

  test('says what the install page needs and nothing about the app’s secrets', async () => {
    const app = await bareApp({
      name: 'Describe me',
      description: 'Takes cards',
      redirectUrls: ['https://app.example/cb'],
    })
    const found = (await methods.availableApps(SHOP)).find((a) => a.id === app.id)
    assert.deepEqual(Object.keys(found ?? {}).sort(), [
      'appUrl',
      'clientId',
      'description',
      'iconUrl',
      'id',
      'name',
      'redirectUrls',
    ])
    assert.equal(found?.description, 'Takes cards')
  })
})
