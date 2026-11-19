// Installing without the consent screen, the catalog and installed lists, uninstalling (the token, the hook), the
// session token the embedded page gets, and the data an app keeps per shop.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'
import { appInstallations } from '../src/apps.schema'
import { type ApiScope, apiTokens, apps } from '@shopnex/core/schema'

const { db, eq, appService, SHOP } = fx
const { AppError } = await import('../src/apps.errors')
const { appUninstalled } = await import('../src')
const { decodeSessionToken } = await import('@shopnex/marketplace-sdk/session-token')
const { resolveApiToken, mintToken } = await import('@shopnex/tenancy')

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

async function install(app: { id: string }, scopes: ApiScope[] = ['read_products'], shopId = SHOP) {
  const u = await fx.user()
  return appService.installManaged({ appId: app.id, shopId, userId: u.id, scopes })
}
const tokenOf = async (installationId: string) => {
  const [row] = await db.select().from(appInstallations).where(eq(appInstallations.id, installationId))
  return row?.apiTokenId ? (await db.select().from(apiTokens).where(eq(apiTokens.id, row.apiTokenId)))[0] : undefined
}

describe('installing an app that needs no consent screen', () => {
  test('makes the installation and a token of its own for the scopes given, in the shop', async () => {
    const a = await fx.newApp({ redirectUrls: [] })
    const i = await install(a.app, ['read_products'])
    assert.deepEqual([i.appId, i.shopId, i.scopes, i.uninstalledAt], [a.app.id, SHOP, ['read_products'], null])
    const t = await tokenOf(i.id)
    assert.deepEqual([t?.appId, t?.shopId, t?.scopes, t?.name], [a.app.id, SHOP, ['read_products'], a.app.name])
    assert.equal((await appService.getInstallation(SHOP, a.app.id))?.id, i.id)
  })

  test('an app that does not exist is not found', async () => {
    const u = await fx.user()
    await assert.rejects(
      appService.installManaged({
        appId: '00000000-0000-4000-8000-000000000000',
        shopId: SHOP,
        userId: u.id,
        scopes: [],
      }),
      refused('APP_NOT_FOUND'),
    )
  })

  test('installing again while installed keeps the installation and its token and changes the scopes', async () => {
    const a = await fx.newApp({ redirectUrls: [] })
    const first = await install(a.app, ['read_products'])
    const tokenBefore = await tokenOf(first.id)
    const second = await install(a.app, ['read_products', 'write_orders'])
    assert.equal(second.id, first.id)
    assert.deepEqual(second.scopes, ['read_products', 'write_orders'])
    const tokenAfter = await tokenOf(second.id)
    assert.equal(tokenAfter?.id, tokenBefore?.id)
    assert.deepEqual(tokenAfter?.scopes, ['read_products', 'write_orders'])
  })

  test('installing after an uninstall reuses the installation row with a new token', async () => {
    const a = await fx.newApp({ redirectUrls: [] })
    const first = await install(a.app)
    const oldToken = await tokenOf(first.id)
    await appService.uninstall(SHOP, first.id)
    const again = await install(a.app)
    assert.equal(again.id, first.id)
    assert.equal(again.uninstalledAt, null)
    assert.notEqual((await tokenOf(again.id))?.id, oldToken?.id)
  })

  test('the same app can be installed in two shops, each with its own token', async () => {
    const a = await fx.newApp({ redirectUrls: [] })
    const other = await fx.shop()
    const one = await install(a.app)
    const two = await install(a.app, ['read_products'], other.id)
    assert.notEqual(one.id, two.id)
    assert.notEqual((await tokenOf(one.id))?.id, (await tokenOf(two.id))?.id)
  })
})

describe('what a shop sees', () => {
  test('the catalog lists every app that is not delisted, by name, marked installed here or not', async () => {
    const [b, a] = [await fx.newApp({ name: 'zz Catalog B' }), await fx.newApp({ name: 'zz Catalog A' })]
    const delisted = await fx.newApp({ name: 'zz Catalog Hidden' })
    await db.update(apps).set({ delistedAt: new Date() }).where(eq(apps.id, delisted.app.id))
    const i = await install(a.app)
    const mine = (await appService.listCatalog(SHOP)).filter((x) => x.name.startsWith('zz Catalog'))
    assert.deepEqual(
      mine.map((x) => [x.name, x.installed, x.installationId]),
      [
        ['zz Catalog A', true, i.id],
        ['zz Catalog B', false, null],
      ],
    )
    const other = await fx.shop()
    assert.equal(
      (await appService.listCatalog(other.id)).find((x) => x.id === a.app.id)?.installed,
      false,
      'installs are per shop',
    )
    assert.ok(b)
  })

  test('installed apps: newest first, never an uninstalled one, with when its token was last used', async () => {
    const [a, b] = [await fx.newApp(), await fx.newApp()]
    const first = await install(a.app)
    await new Promise((r) => setTimeout(r, 5))
    const second = await install(b.app)
    await db
      .update(appInstallations)
      .set({ installedAt: new Date(Date.now() + 1000) })
      .where(eq(appInstallations.id, second.id))
    const listed = (await appService.listInstallations(SHOP)).filter((x) => [first.id, second.id].includes(x.id))
    assert.deepEqual(
      listed.map((x) => x.id),
      [second.id, first.id],
    )
    assert.ok('lastUsedAt' in listed[0]!)
    await appService.uninstall(SHOP, first.id)
    assert.deepEqual(
      (await appService.listInstallations(SHOP)).filter((x) => x.id === first.id),
      [],
    )
  })

  test('a bundled app whose server is not configured is not shown as installed', async () => {
    delete process.env.STRIPE_APP_URL
    delete process.env.SHOPNEX_BUNDLED_APPS
    const u = await fx.user()
    const [app] = await db
      .insert(apps)
      .values({
        source: 'bundled',
        name: 'Stripe (test)',
        clientId: 'app_stripe',
        appUrl: 'http://127.0.0.1:1',
        redirectUrls: [],
        scopes: [],
      })
      .onConflictDoUpdate({ target: apps.clientId, set: { source: 'bundled' } })
      .returning()
    const [i] = await db
      .insert(appInstallations)
      .values({ appId: app!.id, shopId: SHOP, scopes: [], installedById: u.id })
      .returning()
    try {
      assert.equal(
        (await appService.listInstallations(SHOP)).some((x) => x.id === i!.id),
        false,
      )
      process.env.STRIPE_APP_URL = 'http://127.0.0.1:1'
      assert.equal(
        (await appService.listInstallations(SHOP)).some((x) => x.id === i!.id),
        true,
      )
    } finally {
      delete process.env.STRIPE_APP_URL
      await db.delete(apps).where(eq(apps.id, app!.id))
    }
  })

  test('getInstallationWithApp is for this shop and a live installation', async () => {
    const a = await fx.newApp()
    const i = await install(a.app)
    const found = await appService.getInstallationWithApp(SHOP, i.id)
    assert.equal(found?.app.id, a.app.id)
    const other = await fx.shop()
    assert.equal(await appService.getInstallationWithApp(other.id, i.id), null)
    await appService.uninstall(SHOP, i.id)
    assert.equal(await appService.getInstallationWithApp(SHOP, i.id), null)
  })
})

describe('uninstalling', () => {
  test('revokes the app’s token, marks the installation uninstalled with no token, and the second time is null', async () => {
    const a = await fx.newApp()
    const i = await install(a.app)
    const t = await tokenOf(i.id)
    assert.ok(t)
    const done = await appService.uninstall(SHOP, i.id)
    assert.ok(done?.uninstalledAt)
    assert.equal(done?.apiTokenId, null)
    const [revoked] = await db.select().from(apiTokens).where(eq(apiTokens.id, t.id))
    assert.ok(revoked?.revokedAt)
    assert.equal(await appService.uninstall(SHOP, i.id), null)
  })

  test('another shop cannot uninstall it, and an unknown installation is null', async () => {
    const a = await fx.newApp()
    const i = await install(a.app)
    const other = await fx.shop()
    assert.equal(await appService.uninstall(other.id, i.id), null)
    assert.equal(await appService.uninstall(SHOP, '00000000-0000-4000-8000-000000000000'), null)
    assert.ok(await appService.getInstallation(SHOP, a.app.id))
  })

  test('tells the listeners of appUninstalled inside the transaction, and a listener that fails undoes the uninstall', async () => {
    const seen: unknown[] = []
    appUninstalled.on('test.records', (_conn, payload) => void seen.push(payload))
    const a = await fx.newApp()
    const i = await install(a.app)
    await appService.uninstall(SHOP, i.id)
    assert.deepEqual(seen, [{ shopId: SHOP, appId: a.app.id }])

    const kept = await fx.newApp()
    const k = await install(kept.app)
    const token = await tokenOf(k.id)
    appUninstalled.on('test.fails', () => {
      throw new Error('cleanup failed')
    })
    try {
      await assert.rejects(appService.uninstall(SHOP, k.id), /cleanup failed/)
    } finally {
      appUninstalled.on('test.fails', () => undefined)
      appUninstalled.on('test.records', () => undefined)
    }
    assert.ok(await appService.getInstallation(SHOP, kept.app.id), 'still installed')
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, token!.id))
    assert.equal(row?.revokedAt, null, 'and its token is not revoked')
  })
})

describe('the session token for the embedded page', () => {
  test('is for the app, the shop, the installation and the person, and signed by this instance', async () => {
    const a = await fx.newApp()
    const i = await install(a.app)
    const u = await fx.user()
    const token = await appService.createSessionToken({ shopId: SHOP, installationId: i.id, userId: u.id })
    const claims = decodeSessionToken(token)
    assert.deepEqual(
      [claims?.aud, claims?.sub, claims?.shop_id, claims?.sid, claims?.iss],
      [a.app.clientId, u.id, SHOP, i.id, fx.AUDIENCE],
    )
  })

  test('is refused for an installation that does not exist, is another shop’s, or was uninstalled', async () => {
    const a = await fx.newApp()
    const i = await install(a.app)
    const u = await fx.user()
    const other = await fx.shop()
    await assert.rejects(
      appService.createSessionToken({ shopId: other.id, installationId: i.id, userId: u.id }),
      refused('INSTALLATION_NOT_FOUND'),
    )
    await appService.uninstall(SHOP, i.id)
    await assert.rejects(
      appService.createSessionToken({ shopId: SHOP, installationId: i.id, userId: u.id }),
      refused('INSTALLATION_NOT_FOUND'),
    )
  })
})

describe('app data', () => {
  async function appToken() {
    const a = await fx.newApp()
    const i = await install(a.app)
    return (await tokenOf(i.id))!
  }

  test('an app keeps values by key for its shop: set, read, list in key order, replace, delete', async () => {
    const t = await appToken()
    await appService.setAppData(t, 'b', { n: 2 })
    await appService.setAppData(t, 'a', 'text')
    assert.deepEqual(
      (await appService.listAppData(t)).map((r) => [r.key, r.value]),
      [
        ['a', 'text'],
        ['b', { n: 2 }],
      ],
    )
    await appService.setAppData(t, 'a', 'changed')
    assert.equal((await appService.getAppData(t, 'a'))?.value, 'changed')
    assert.equal(await appService.getAppData(t, 'missing'), null)
    assert.deepEqual(await appService.deleteAppData(t, 'a'), { key: 'a' })
    assert.equal(await appService.deleteAppData(t, 'a'), null)
  })

  test('each installation has its own data', async () => {
    const [one, two] = [await appToken(), await appToken()]
    await appService.setAppData(one, 'shared-name', 1)
    assert.equal(await appService.getAppData(two, 'shared-name'), null)
    assert.deepEqual(await appService.listAppData(two), [])
  })

  test('only an app’s own token, with a live installation, may use it', async () => {
    const hand = mintToken()
    const [plain] = await db
      .insert(apiTokens)
      .values({ shopId: SHOP, name: 'Hand made', scopes: [], tokenHash: hand.tokenHash, tokenPrefix: hand.tokenPrefix })
      .returning()
    try {
      await assert.rejects(appService.listAppData(plain!), refused('APP_NOT_FOUND'))
    } finally {
      await db.delete(apiTokens).where(eq(apiTokens.id, plain!.id))
    }
    const a = await fx.newApp()
    const i = await install(a.app)
    const t = (await tokenOf(i.id))!
    await appService.uninstall(SHOP, i.id)
    await assert.rejects(appService.getAppData(t, 'x'), refused('INSTALLATION_NOT_FOUND'))
    assert.equal(await resolveApiToken('sk_not_a_token'), null)
  })

  test('a value over 64 KB is refused, and so is a 101st key, though an existing key can still be replaced', async () => {
    const t = await appToken()
    await assert.rejects(appService.setAppData(t, 'big', 'x'.repeat(64 * 1024 + 10)), refused('APP_DATA_TOO_LARGE'))
    await appService.setAppData(t, 'fits', 'x'.repeat(60 * 1024))
    for (let i = 0; i < 99; i++) await appService.setAppData(t, `k${String(i)}`, i)
    assert.equal((await appService.listAppData(t)).length, 100)
    await assert.rejects(appService.setAppData(t, 'one-too-many', 1), refused('APP_DATA_TOO_LARGE'))
    await appService.setAppData(t, 'k0', 'replaced')
    assert.equal((await appService.getAppData(t, 'k0'))?.value, 'replaced')
  })
})
