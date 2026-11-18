// Uninstalling an app through the real route takes the app's payment method out of checkout, though `apps` knows nothing of payments:
// it runs the appUninstalled hook inside its transaction and payments listens. Both manual methods and other apps' methods stay.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { call } from '@orpc/server'
import { apps } from '@shopnex/core/schema'

// Set before the modules load: @shopnex/db picks its database when it is first imported
process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
const { appInstallations } = await import('@shopnex/apps/schema')
requireEmbeddedDatabase()
const { configureRpc } = await import('@shopnex/rpc')
const { router } = await import('../src/router')
const { appUninstalled } = await import('@shopnex/apps')
const { paymentMethods } = await import('@shopnex/payments/schema')
const { aiProviders } = await import('@shopnex/ai/schema')
const { eq, inArray } = await import('drizzle-orm')

const SHOP = 'default'
const shop = { id: SHOP, storefrontUrl: null } as never
const admin = (router as unknown as { admin: Record<string, Record<string, unknown>> }).admin
const run = (procedure: unknown, input?: unknown) =>
  call(procedure as Parameters<typeof call>[0], input, { context: { headers: new Headers() } } as never)

const appIds: string[] = []
let manualId = ''

async function installedPaymentsApp(name: string) {
  const [app] = await db
    .insert(apps)
    .values({
      name,
      appUrl: 'http://127.0.0.1:1',
      redirectUrls: [],
      scopes: [],
      clientId: `hook-${name}-${Date.now()}`,
    })
    .returning()
  const [installation] = await db
    .insert(appInstallations)
    .values({ appId: app!.id, shopId: SHOP, scopes: [] })
    .returning()
  const [method] = await db
    .insert(paymentMethods)
    .values({
      shopId: SHOP,
      provider: 'app',
      name,
      appId: app!.id,
      gateway: 'hookpay',
      paymentSessionUrl: 'http://127.0.0.1:1/pay',
      refundSessionUrl: 'http://127.0.0.1:1/refund',
    })
    .returning()
  appIds.push(app!.id)
  return { installation: installation!, method: method! }
}
const exists = async (id: string) =>
  (await db.select({ id: paymentMethods.id }).from(paymentMethods).where(eq(paymentMethods.id, id))).length === 1

before(async () => {
  await prepareDatabase()
  configureRpc({
    session: () => Promise.resolve({ session: { activeOrganizationId: SHOP }, user: { id: 'u1' } } as never),
    adminShop: () => Promise.resolve({ shop, role: 'admin' as const, superAdmin: false }),
    token: () => Promise.resolve(null),
    hasScope: () => false,
  })
  const [manual] = await db
    .insert(paymentMethods)
    .values({ shopId: SHOP, name: 'Bank transfer (hook test)' })
    .returning()
  manualId = manual!.id
})

after(async () => {
  await db.delete(paymentMethods).where(eq(paymentMethods.id, manualId))
  if (appIds.length) await db.delete(apps).where(inArray(apps.id, appIds))
})

describe('uninstalling an app, through the route', () => {
  test('payments has listened to the hook', () => {
    assert.ok(appUninstalled.listeners.includes('payments.method'))
    assert.ok(appUninstalled.listeners.includes('ai.providers'))
  })

  test('removes the method of the app that was uninstalled, and only that one', async () => {
    const gone = await installedPaymentsApp('Hook pay one')
    const stays = await installedPaymentsApp('Hook pay two')
    await run(admin.apps!.uninstall, { id: gone.installation.id })
    assert.equal(await exists(gone.method.id), false, 'the uninstalled app’s method is gone')
    assert.equal(await exists(stays.method.id), true, 'another app’s method stays')
    assert.equal(await exists(manualId), true, 'a manual method stays')
  })

  test('removes the AI capabilities of the app that was uninstalled, and only that one', async () => {
    const gone = await installedPaymentsApp('Hook ai one')
    const stays = await installedPaymentsApp('Hook ai two')
    for (const { installation } of [gone, stays]) {
      await db
        .insert(aiProviders)
        .values({ shopId: SHOP, appId: installation.appId, capability: 'product.seo', url: 'http://127.0.0.1:1/run' })
    }
    await run(admin.apps!.uninstall, { id: gone.installation.id })
    const left = await db
      .select()
      .from(aiProviders)
      .where(inArray(aiProviders.appId, [gone.installation.appId, stays.installation.appId]))
    assert.deepEqual(
      left.map((r) => r.appId),
      [stays.installation.appId],
    )
  })

  test('a listener that fails undoes the uninstall: the method and the installation are both still there', async () => {
    const app = await installedPaymentsApp('Hook pay three')
    appUninstalled.on('test.fails', () => {
      throw new Error('cleanup failed')
    })
    try {
      await assert.rejects(run(admin.apps!.uninstall, { id: app.installation.id }))
    } finally {
      appUninstalled.on('test.fails', () => undefined)
    }
    assert.equal(await exists(app.method.id), true)
    const [installation] = await db.select().from(appInstallations).where(eq(appInstallations.id, app.installation.id))
    assert.equal(installation?.uninstalledAt, null)
  })
})
