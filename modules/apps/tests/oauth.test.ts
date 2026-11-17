// Apps as OAuth clients: registering one, what an authorize request may ask for, the code exchange (single use, bound to the app and
// the redirect), client assertions, session-token exchange, client credentials, and resolving the short-lived access token.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'
import { appAuthorizationCodes, appInstallations } from '../src/apps.schema'
import { apps } from '@shopnex/core/schema'

const { db, schema, eq, appService, SHOP, REDIRECT } = fx
const { AppError } = await import('../src/apps.errors')
const { decodeJwt, createClientAssertion } = await import('@shopnex/marketplace-sdk/keys')
const { APP_INSTALLED_PATH } = await import('@shopnex/marketplace-sdk/lifecycle')
const { resolveApiToken } = await import('@shopnex/tenancy')
const { signSessionToken } = await import('@shopnex/marketplace-sdk/session-token')
const { instanceSigner } = await import('../src/keys')

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

async function authorize(app: Awaited<ReturnType<typeof fx.newApp>>, shopId = SHOP) {
  const u = await fx.user()
  const code = await appService.createAuthorizationCode({
    appId: app.app.id,
    shopId,
    userId: u.id,
    scopes: app.app.scopes,
    redirectUri: REDIRECT,
  })
  return { code, user: u }
}
const exchange = async (app: Awaited<ReturnType<typeof fx.newApp>>, code: string, redirectUri = REDIRECT) =>
  appService.exchangeCode({ clientId: app.app.clientId, clientAssertion: await app.assertion(), code, redirectUri })

describe('registering an app', () => {
  test('gives it a client id and a key pair: the private key is shown once, the public one is stored; scopes are normalized', async () => {
    const a = await fx.newApp({ scopes: ['write_orders', 'read_orders', 'read_products'] })
    assert.match(a.app.clientId, /^app_\S{8,}$/)
    assert.match(a.privateKey, /^snxk_/)
    assert.ok(a.app.publicKey)
    assert.ok(!JSON.stringify(a.app).includes(a.privateKey))
    assert.deepEqual(
      a.app.scopes.filter((s) => s.endsWith('_orders')),
      ['write_orders'],
    )
    assert.equal(a.app.source, 'custom')
    assert.equal(a.app.managed, false, 'it has redirect URLs')
    const managed = await fx.newApp({ redirectUrls: [] })
    assert.equal(managed.app.managed, true)
  })

  test('only custom apps are listed, read, changed, deleted or given a new key; a bundled one is left alone', async () => {
    const mine = await fx.newApp({ name: 'Zeta mine' })
    const [bundled] = await db
      .insert(apps)
      .values({
        source: 'bundled',
        name: 'Bundled one',
        clientId: `app_b_${fx.unique()}`,
        appUrl: 'http://127.0.0.1:1',
        redirectUrls: [],
        scopes: [],
      })
      .returning()
    try {
      const listed = (await appService.listApps()).map((a) => a.id)
      assert.ok(listed.includes(mine.app.id) && !listed.includes(bundled!.id))
      assert.equal((await appService.getApp(mine.app.id))?.id, mine.app.id)
      assert.equal(await appService.getApp(bundled!.id), null)
      assert.equal(await appService.updateApp(bundled!.id, { name: 'Hacked' }), null)
      assert.equal(await appService.rotateKey(bundled!.id), null)
      assert.equal(await appService.deleteApp(bundled!.id), null)
      assert.equal((await appService.clientIdOf(bundled!.id))?.startsWith('app_b_'), true, 'clientIdOf reads any app')
      assert.equal(await appService.clientIdOf('00000000-0000-4000-8000-000000000000'), null)
    } finally {
      await db.delete(apps).where(eq(apps.id, bundled!.id))
    }
  })

  test('updating normalizes scopes again; deleting returns the app', async () => {
    const a = await fx.newApp()
    const changed = await appService.updateApp(a.app.id, {
      scopes: ['write_products', 'read_products'],
      name: 'Renamed',
    })
    assert.equal(changed?.name, 'Renamed')
    assert.deepEqual(changed?.scopes, ['write_products'])
    assert.equal((await appService.deleteApp(a.app.id))?.id, a.app.id)
    assert.equal(await appService.getApp(a.app.id), null)
  })

  test('a new key stops the old one working at once', async () => {
    const a = await fx.newApp()
    const oldAssertion = await a.assertion()
    const rotated = await appService.rotateKey(a.app.id)
    assert.ok(rotated && rotated.privateKey !== a.privateKey)
    assert.notEqual(rotated.app.publicKey, a.app.publicKey)
    await assert.rejects(appService.authenticateClient(a.app.clientId, oldAssertion), refused('invalid_client'))
    const fresh = await createClientAssertion(rotated.privateKey, a.app.clientId, fx.AUDIENCE)
    assert.equal((await appService.authenticateClient(a.app.clientId, fresh)).id, a.app.id)
  })
})

describe('what an authorize request may ask for', () => {
  test('scopes are parsed from spaces or commas, normalized, and unknown ones refuse the whole thing', () => {
    assert.deepEqual(appService.parseScopes('read_products, write_orders'), ['read_products', 'write_orders'])
    assert.deepEqual(appService.parseScopes('write_orders read_orders'), ['write_orders'])
    assert.equal(appService.parseScopes('read_products nonsense'), null)
    assert.deepEqual(appService.parseScopes(''), [])
  })

  test('an unknown or delisted app is an invalid client', async () => {
    const a = await fx.newApp()
    await assert.rejects(appService.validateAuthorizeRequest({ clientId: 'app_nope' }), refused('invalid_client'))
    await db.update(apps).set({ delistedAt: new Date() }).where(eq(apps.id, a.app.id))
    await assert.rejects(appService.validateAuthorizeRequest({ clientId: a.app.clientId }), refused('invalid_client'))
  })

  test('the redirect must be one the app registered (none given is accepted)', async () => {
    const a = await fx.newApp()
    await assert.rejects(
      appService.validateAuthorizeRequest({ clientId: a.app.clientId, redirectUri: 'http://evil.example/cb' }),
      refused('invalid_redirect_uri'),
    )
    assert.ok(await appService.validateAuthorizeRequest({ clientId: a.app.clientId, redirectUri: REDIRECT }))
    assert.ok(await appService.validateAuthorizeRequest({ clientId: a.app.clientId }))
  })

  test('the scopes must be among the app’s (a write scope covers its read), and none means all of them', async () => {
    const a = await fx.newApp({ scopes: ['read_products', 'write_orders'] })
    const ask = (scope?: string) => appService.validateAuthorizeRequest({ clientId: a.app.clientId, scope })
    assert.deepEqual((await ask('read_orders')).scopes, ['read_orders'], 'write_orders covers read_orders')
    assert.deepEqual((await ask('read_products write_orders')).scopes, ['read_products', 'write_orders'])
    assert.deepEqual((await ask()).scopes, a.app.scopes)
    assert.deepEqual((await ask('')).scopes, a.app.scopes)
    for (const scope of ['write_products', 'read_customers', 'bogus'])
      await assert.rejects(ask(scope), refused('invalid_scope'), scope)
  })
})

describe('exchanging an authorization code', () => {
  test('makes the installation and its token, once; the token works as an API token', async () => {
    const a = await fx.newApp()
    const { code, user } = await authorize(a)
    const result = await exchange(a, code)
    assert.match(result.accessToken, /^sk_/)
    assert.deepEqual([result.shopId, result.scopes], [SHOP, a.app.scopes])
    const [installation] = await db
      .select()
      .from(appInstallations)
      .where(eq(appInstallations.id, result.installationId))
    assert.deepEqual(
      [installation?.appId, installation?.installedById, installation?.uninstalledAt],
      [a.app.id, user.id, null],
    )
    const found = await resolveApiToken(result.accessToken)
    assert.equal(found?.token.appId, a.app.id)
    assert.equal(found?.token.id, installation?.apiTokenId)
    await assert.rejects(exchange(a, code), refused('invalid_grant'), 'a code works once')
  })

  test('tells the app it was installed, signed, at its own address', async () => {
    const a = await fx.newApp()
    const { code } = await authorize(a)
    const { installationId } = await exchange(a, code)
    assert.ok(await fx.until(() => fx.received.some((r) => r.body.installationId === installationId)))
    const call = fx.received.find((r) => r.body.installationId === installationId)!
    assert.equal(call.path, APP_INSTALLED_PATH)
    assert.equal(call.body.kind, 'installed')
    assert.equal(call.body.shopId, SHOP)
    assert.ok(Object.keys(call.headers).some((h) => /signature/i.test(h)))
  })

  test('refuses a code for another redirect, one that expired, and one issued to another app', async () => {
    const a = await fx.newApp()
    const other = await fx.newApp()
    const first = await authorize(a)
    await assert.rejects(exchange(a, first.code, 'http://127.0.0.1/elsewhere'), refused('invalid_grant'))
    const expired = await authorize(a)
    await db.update(appAuthorizationCodes).set({ expiresAt: new Date(Date.now() - 1000) })
    await assert.rejects(exchange(a, expired.code), refused('invalid_grant'))
    const fresh = await authorize(a)
    await assert.rejects(exchange(other, fresh.code), refused('invalid_grant'))
    assert.ok(await exchange(a, fresh.code), 'and it still works for the app it was issued to')
  })

  test('the app proves who it is with a signed assertion for this instance: another key, another audience or junk is refused', async () => {
    const a = await fx.newApp()
    const stranger = await fx.newApp()
    const { code } = await authorize(a)
    const exchangeWith = (clientAssertion: string) =>
      appService.exchangeCode({ clientId: a.app.clientId, clientAssertion, code, redirectUri: REDIRECT })
    await assert.rejects(exchangeWith(await stranger.assertion()), refused('invalid_client'))
    await assert.rejects(
      exchangeWith(await createClientAssertion(a.privateKey, a.app.clientId, 'http://other.example')),
      refused('invalid_client'),
    )
    await assert.rejects(exchangeWith('not.a.jwt'), refused('invalid_client'))
    await assert.rejects(
      appService.exchangeCode({
        clientId: 'app_unknown',
        clientAssertion: await a.assertion(),
        code,
        redirectUri: REDIRECT,
      }),
      refused('invalid_client'),
    )
    assert.ok(await exchangeWith(await a.assertion()), 'none of the refusals used up the code')
  })

  test('authorizing again on a live installation keeps the installation and replaces the token’s secret and scopes', async () => {
    const a = await fx.newApp()
    const one = await exchange(a, (await authorize(a)).code)
    const two = await exchange(a, (await authorize(a)).code)
    assert.equal(two.installationId, one.installationId)
    assert.equal(await resolveApiToken(one.accessToken), null, 'the old secret no longer works')
    assert.ok(await resolveApiToken(two.accessToken))
    const rows = await db.select().from(appInstallations).where(eq(appInstallations.appId, a.app.id))
    assert.equal(rows.length, 1)
  })
})

describe('access tokens for the embedded app', () => {
  async function installed() {
    const a = await fx.newApp()
    const { installationId } = await exchange(a, (await authorize(a)).code)
    const u = await fx.user()
    const session = await appService.createSessionToken({ shopId: SHOP, installationId, userId: u.id })
    return { a, installationId, session, u }
  }

  test('a session token from the admin page becomes a one-hour access token, which resolves to its token and shop', async () => {
    const { a, installationId, session } = await installed()
    const t = await appService.exchangeSessionToken({
      clientId: a.app.clientId,
      clientAssertion: await a.assertion(),
      subjectToken: session,
    })
    assert.deepEqual([t.expiresIn, t.shopId, t.installationId], [3600, SHOP, installationId])
    assert.equal(decodeJwt(t.accessToken)?.header.typ, 'at+jwt')
    const found = await appService.resolveAccessToken(t.accessToken)
    assert.equal(found?.shop.id, SHOP)
    assert.equal(found?.token.appId, a.app.id)
  })

  test('a session token made for another app, or junk, is refused', async () => {
    const { session } = await installed()
    const other = await fx.newApp()
    await assert.rejects(
      appService.exchangeSessionToken({
        clientId: other.app.clientId,
        clientAssertion: await other.assertion(),
        subjectToken: session,
      }),
      refused('invalid_grant'),
    )
    const { a } = await installed()
    await assert.rejects(
      appService.exchangeSessionToken({
        clientId: a.app.clientId,
        clientAssertion: await a.assertion(),
        subjectToken: 'junk',
      }),
      refused('invalid_grant'),
    )
  })

  test('a session token for the right app and shop but another installation is refused', async () => {
    const { a, u } = await installed()
    const forged = await signSessionToken(await instanceSigner(), {
      iss: fx.AUDIENCE,
      aud: a.app.clientId,
      sub: u.id,
      shop_id: SHOP,
      sid: '00000000-0000-4000-8000-000000000000',
    })
    await assert.rejects(
      appService.exchangeSessionToken({
        clientId: a.app.clientId,
        clientAssertion: await a.assertion(),
        subjectToken: forged,
      }),
      refused('invalid_grant'),
    )
  })

  test('client credentials work for a shop where the app is installed, and not for another', async () => {
    const { a } = await installed()
    const ok = await appService.clientCredentials({
      clientId: a.app.clientId,
      clientAssertion: await a.assertion(),
      shopId: SHOP,
    })
    assert.equal(ok.shopId, SHOP)
    const elsewhere = await fx.shop()
    await assert.rejects(
      appService.clientCredentials({
        clientId: a.app.clientId,
        clientAssertion: await a.assertion(),
        shopId: elsewhere.id,
      }),
      refused('invalid_grant'),
    )
  })

  test('uninstalling ends them: the access token no longer resolves, and no new one is given', async () => {
    const { a, installationId, session } = await installed()
    const t = await appService.exchangeSessionToken({
      clientId: a.app.clientId,
      clientAssertion: await a.assertion(),
      subjectToken: session,
    })
    await appService.uninstall(SHOP, installationId)
    assert.equal(await appService.resolveAccessToken(t.accessToken), null)
    await assert.rejects(
      appService.exchangeSessionToken({
        clientId: a.app.clientId,
        clientAssertion: await a.assertion(),
        subjectToken: session,
      }),
      refused('invalid_grant'),
    )
    await assert.rejects(
      appService.clientCredentials({ clientId: a.app.clientId, clientAssertion: await a.assertion(), shopId: SHOP }),
      refused('invalid_grant'),
    )
  })

  test('anything that is not an access token resolves to nothing', async () => {
    const { a } = await installed()
    const long = (await exchange(a, (await authorize(a)).code)).accessToken
    for (const token of [long, 'sk_nope', 'a.b.c', ''])
      assert.equal(await appService.resolveAccessToken(token), null, token)
  })
})
