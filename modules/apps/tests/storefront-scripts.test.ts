// The scripts an app adds to a shop's online store: the app sets its whole list with its own token, each on its own
// origin, never for a marketplace app; the storefront reads only what installed apps provide; uninstalling removes them.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'
import { appStorefrontScripts } from '../src/apps.schema'
import { type ApiScope, apps } from '@shopnex/core/schema'

const { db, eq, appService, SHOP } = fx
const { AppError } = await import('../src/apps.errors')
const { MAX_STOREFRONT_SCRIPTS } = await import('../src/apps')

const refused = (code: string) => (e: unknown) => e instanceof AppError && e.code === code

before(async () => {
  await fx.prepareDatabase()
  await fx.startFakeApp()
})
beforeEach(fx.cleanup)
after(async () => {
  await fx.cleanup()
  await fx.stopFakeApp()
})

async function install(app: { id: string }, shopId = SHOP, scopes: ApiScope[] = ['write_storefront']) {
  const u = await fx.user()
  return appService.installManaged({ appId: app.id, shopId, userId: u.id, scopes })
}
const widget = (query = '') => `${fx.appUrl}/widget.js${query}`

describe('setting the scripts', () => {
  test('are saved for the shop, query string and all, and the storefront reads them', async () => {
    const { app } = await fx.newApp({ redirectUrls: [] })
    await install(app)
    const src = widget('?instance=https%3A%2F%2Fshop.example.com&shop=default')
    assert.deepEqual(await appService.configureStorefrontScripts(SHOP, app.id, [src], db), [src])
    assert.deepEqual(await appService.storefrontScripts(SHOP, db), [src])
  })

  test('setting them again replaces the list; an empty list removes them; repeating is harmless', async () => {
    const { app } = await fx.newApp({ redirectUrls: [] })
    await install(app)
    const a = widget('?v=1')
    const b = widget('?v=2')
    await appService.configureStorefrontScripts(SHOP, app.id, [a], db)
    await appService.configureStorefrontScripts(SHOP, app.id, [a], db)
    assert.deepEqual(await appService.storefrontScripts(SHOP, db), [a])
    await appService.configureStorefrontScripts(SHOP, app.id, [b], db)
    assert.deepEqual(await appService.storefrontScripts(SHOP, db), [b])
    await appService.configureStorefrontScripts(SHOP, app.id, [], db)
    assert.deepEqual(await appService.storefrontScripts(SHOP, db), [])
  })

  test('the same address twice is one script', async () => {
    const { app } = await fx.newApp({ redirectUrls: [] })
    await install(app)
    assert.deepEqual(await appService.configureStorefrontScripts(SHOP, app.id, [widget(), widget()], db), [widget()])
  })

  test('only on the app’s own origin: another host, port, scheme or a look-alike is refused', async () => {
    const { app } = await fx.newApp({ redirectUrls: [] })
    await install(app)
    const url = new URL(fx.appUrl)
    for (const bad of [
      'https://evil.example.com/widget.js',
      `http://${url.hostname}:${Number(url.port) + 1}/widget.js`,
      `https://${url.hostname}:${url.port}/widget.js`,
      `http://${url.hostname}.evil.test:${url.port}/widget.js`,
      `http://user@${url.hostname}.evil.test:${url.port}/widget.js`,
      'javascript:alert(1)',
      'data:text/javascript,alert(1)',
    ]) {
      await assert.rejects(
        appService.configureStorefrontScripts(SHOP, app.id, [bad], db),
        refused('SCRIPT_URL_INVALID'),
        bad,
      )
    }
    assert.deepEqual(await appService.storefrontScripts(SHOP, db), [])
  })

  test(`at most ${MAX_STOREFRONT_SCRIPTS}`, async () => {
    const { app } = await fx.newApp({ redirectUrls: [] })
    await install(app)
    const many = Array.from({ length: MAX_STOREFRONT_SCRIPTS + 1 }, (_, i) => widget(`?n=${i}`))
    await assert.rejects(appService.configureStorefrontScripts(SHOP, app.id, many, db), refused('SCRIPT_URL_INVALID'))
    assert.equal(
      (await appService.configureStorefrontScripts(SHOP, app.id, many.slice(1), db)).length,
      MAX_STOREFRONT_SCRIPTS,
    )
  })

  test('a marketplace app may not (a script runs on every page, with the shopper’s session)', async () => {
    const { app } = await fx.newApp({ redirectUrls: [] })
    await install(app)
    await db.update(apps).set({ source: 'marketplace' }).where(eq(apps.id, app.id))
    await assert.rejects(
      appService.configureStorefrontScripts(SHOP, app.id, [widget()], db),
      refused('SCRIPTS_NOT_ALLOWED'),
    )
  })

  test('an app that does not exist is not found', async () => {
    await assert.rejects(
      appService.configureStorefrontScripts(SHOP, '00000000-0000-4000-8000-000000000000', [], db),
      refused('APP_NOT_FOUND'),
    )
  })
})

describe('what the storefront loads', () => {
  test('is per shop: one shop’s scripts are not another’s', async () => {
    const { app } = await fx.newApp({ redirectUrls: [] })
    const other = await fx.shop()
    await install(app)
    await install(app, other.id)
    await appService.configureStorefrontScripts(SHOP, app.id, [widget('?shop=a')], db)
    await appService.configureStorefrontScripts(other.id, app.id, [widget('?shop=b')], db)
    assert.deepEqual(await appService.storefrontScripts(SHOP, db), [widget('?shop=a')])
    assert.deepEqual(await appService.storefrontScripts(other.id, db), [widget('?shop=b')])
  })

  test('uninstalling the app removes its scripts, and installing again does not bring them back', async () => {
    const { app } = await fx.newApp({ redirectUrls: [] })
    const installation = await install(app)
    await appService.configureStorefrontScripts(SHOP, app.id, [widget()], db)
    await appService.uninstall(SHOP, installation.id)
    assert.deepEqual(await appService.storefrontScripts(SHOP, db), [])
    assert.equal((await db.select().from(appStorefrontScripts).where(eq(appStorefrontScripts.appId, app.id))).length, 0)
    await install(app)
    assert.deepEqual(await appService.storefrontScripts(SHOP, db), [])
  })

  test('only apps installed now count, even if a row were left behind', async () => {
    const { app } = await fx.newApp({ redirectUrls: [] })
    await db.insert(appStorefrontScripts).values({ shopId: SHOP, appId: app.id, src: widget() })
    assert.deepEqual(await appService.storefrontScripts(SHOP, db), [], 'not installed')
    const installation = await install(app)
    assert.deepEqual(await appService.storefrontScripts(SHOP, db), [widget()])
    await db.update(apps).set({ source: 'marketplace' }).where(eq(apps.id, app.id))
    assert.deepEqual(await appService.storefrontScripts(SHOP, db), [], 'a marketplace app is left out')
    await db.update(apps).set({ source: 'custom' }).where(eq(apps.id, app.id))
    await appService.uninstall(SHOP, installation.id)
    assert.deepEqual(await appService.storefrontScripts(SHOP, db), [])
  })

  test('two apps: both, in the order they were added', async () => {
    const a = await fx.newApp({ redirectUrls: [] })
    const b = await fx.newApp({ redirectUrls: [] })
    await install(a.app)
    await install(b.app)
    await appService.configureStorefrontScripts(SHOP, a.app.id, [widget('?a=1')], db)
    await new Promise((r) => setTimeout(r, 15))
    await appService.configureStorefrontScripts(SHOP, b.app.id, [widget('?b=1')], db)
    assert.deepEqual(await appService.storefrontScripts(SHOP, db), [widget('?a=1'), widget('?b=1')])
  })
})
