// What cart does when an app is uninstalled: the app's carrier service leaves checkout, and only that app's. (Apps does not know about
// carrier services: it runs the appUninstalled hook inside the uninstall and cart listens.)
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { apps } from '@shopnex/core/schema'
import * as fx from './fixtures'
import { carrierServices } from '../src/cart.schema'

const { db, eq, SHOP } = fx
const { appService, appUninstalled } = await import('@shopnex/apps')
const { carrierService } = await import('../src')

before(fx.prepareDatabase)
beforeEach(fx.cleanup)
after(fx.cleanup)

async function installedCarrier(name: string, shopId = SHOP) {
  const [app] = await db
    .insert(apps)
    .values({
      name,
      appUrl: 'http://127.0.0.1:1/app',
      redirectUrls: [],
      scopes: ['write_shipping'],
      clientId: `app_h_${fx.unique()}`,
    })
    .returning()
  fx.trackApp(app!.id)
  const installation = await appService.installManaged({
    appId: app!.id,
    shopId,
    userId: null as unknown as string,
    scopes: ['write_shipping'],
  })
  await carrierService.configure(shopId, app!.id, { name, ratesUrl: 'http://127.0.0.1:1/rates', ready: true })
  return { app: app!, installation }
}

describe('uninstalling a carrier app', () => {
  test('cart listens to the hook', () => {
    assert.ok(appUninstalled.listeners.includes('cart.carrier-services'))
  })

  test('takes the app’s carrier service off checkout, and only this app’s', async () => {
    const [a, b] = [await installedCarrier('A'), await installedCarrier('B')]
    assert.equal((await carrierService.list(SHOP)).length, 2)
    await appService.uninstall(SHOP, a.installation.id)
    assert.deepEqual(
      (await carrierService.list(SHOP)).map((s) => s.appId),
      [b.app.id],
    )
  })

  test('another shop’s service for the same app stays', async () => {
    await fx.otherShop()
    const a = await installedCarrier('A')
    await carrierService.configure(fx.OTHER_SHOP, a.app.id, {
      name: 'A',
      ratesUrl: 'http://127.0.0.1:1/rates',
      ready: true,
    })
    await appService.uninstall(SHOP, a.installation.id)
    assert.equal((await carrierService.list(SHOP)).length, 0)
    assert.equal((await carrierService.list(fx.OTHER_SHOP)).length, 1)
    assert.equal((await db.select().from(carrierServices).where(eq(carrierServices.shopId, fx.OTHER_SHOP))).length, 1)
  })
})
