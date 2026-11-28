// An app the marketplace takes out of the App Store (delisted) stops working everywhere, not only for new installs: it can't
// authenticate, and the tokens it already holds (the long-lived sk_ token and short-lived access tokens) are refused. Nothing is
// deleted or revoked, so listing it again brings it back.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import * as fx from './fixtures'
import { apiTokens, apps } from '@shopnex/core/schema'

const { db, eq, appService, SHOP, REDIRECT } = fx
const { AppError } = await import('../src/apps.errors')
const { createApiToken, resolveApiToken } = await import('@shopnex/tenancy')

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

const delist = (id: string) => db.update(apps).set({ delistedAt: new Date() }).where(eq(apps.id, id))
const list = (id: string) => db.update(apps).set({ delistedAt: null }).where(eq(apps.id, id))

/** An installed app with the credentials it holds: its sk_ token, a short-lived access token, and a code not yet used */
async function installed() {
  const a = await fx.newApp()
  const u = await fx.user()
  const code = () =>
    appService.createAuthorizationCode({
      appId: a.app.id,
      shopId: SHOP,
      userId: u.id,
      scopes: a.app.scopes,
      redirectUri: REDIRECT,
    })
  const { accessToken: sk } = await appService.exchangeCode({
    clientId: a.app.clientId,
    clientAssertion: await a.assertion(),
    code: await code(),
    redirectUri: REDIRECT,
  })
  const { accessToken: jwt } = await appService.clientCredentials({
    clientId: a.app.clientId,
    clientAssertion: await a.assertion(),
    shopId: SHOP,
  })
  return { a, sk, jwt, unusedCode: await code() }
}

describe('a delisted app', () => {
  test('control: before it is delisted, every credential it holds works', async () => {
    const { a, sk, jwt } = await installed()
    assert.equal((await resolveApiToken(sk))?.token.appId, a.app.id)
    assert.ok(await appService.resolveAccessToken(jwt))
  })

  test('cannot authenticate: a code exchange and client credentials are refused', async () => {
    const { a, unusedCode } = await installed()
    await delist(a.app.id)
    await assert.rejects(
      appService.exchangeCode({
        clientId: a.app.clientId,
        clientAssertion: await a.assertion(),
        code: unusedCode,
        redirectUri: REDIRECT,
      }),
      refused('invalid_client'),
    )
    await assert.rejects(
      appService.clientCredentials({ clientId: a.app.clientId, clientAssertion: await a.assertion(), shopId: SHOP }),
      refused('invalid_client'),
    )
  })

  test('the tokens it already holds stop working: its sk_ token and an access token issued before', async () => {
    const { a, sk, jwt } = await installed()
    await delist(a.app.id)
    assert.equal(await resolveApiToken(sk), null, 'the sk_ token')
    assert.equal(await appService.resolveAccessToken(jwt), null, 'the access token')
  })

  test('listing it again brings everything back: nothing was revoked or deleted', async () => {
    const { a, sk, jwt } = await installed()
    await delist(a.app.id)
    await list(a.app.id)
    assert.ok(await resolveApiToken(sk))
    assert.ok(await appService.resolveAccessToken(jwt))
    await appService.clientCredentials({ clientId: a.app.clientId, clientAssertion: await a.assertion(), shopId: SHOP })
  })

  test('another app, and a token that belongs to no app, are not affected', async () => {
    const gone = await installed()
    const stays = await installed()
    await delist(gone.a.app.id)
    assert.ok(await resolveApiToken(stays.sk))
    assert.ok(await appService.resolveAccessToken(stays.jwt))

    // A merchant's own token has no app at all: the join that looks the app up must not drop it
    const own = await createApiToken(SHOP, { name: 'no app', scopes: ['read_products'], createdById: null })
    try {
      assert.equal((await resolveApiToken(own.token))?.token.id, own.id)
    } finally {
      await db.delete(apiTokens).where(eq(apiTokens.id, own.id))
    }
  })
})
