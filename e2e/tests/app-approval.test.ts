// Marketplace apps and approval: off by default (any marketplace app can be installed); once a super admin requires
// it, shops can only install approved ones. Custom apps never wait, turning it on approves what shops already run,
// and taking an approval back stops new installs without touching installed apps. Uses its own apps (deleted at
// the end) and puts the setting back.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { inArray } from 'drizzle-orm'
import { appService } from '@shopnex/apps'
import { db, schema } from '@shopnex/db'
import { Fixtures, SHOP, closeDb } from '../lib'

const fx = new Fixtures()
const apps: string[] = []
const scopes = ['read_orders'] as const
let wasRequired = false

// What a marketplace sync writes: a marketplace-source row, unapproved
async function marketplaceApp(name: string) {
  const [app] = await db
    .insert(schema.apps)
    .values({
      source: 'marketplace',
      marketplaceAppId: randomUUID(),
      name: `E2E ${name} ${Date.now()}`,
      appUrl: 'http://127.0.0.1:9/app',
      redirectUrls: [],
      scopes: [...scopes],
      clientId: `app_e2e_${randomUUID()}`,
    })
    .returning()
  apps.push(app!.id)
  return app!
}

const install = (appId: string) =>
  appService.installManaged({ appId, shopId: SHOP, userId: null as never, scopes: [...scopes] })
const inCatalog = async (appId: string) => (await appService.listCatalog(SHOP)).some((a) => a.id === appId)
const authorize = (clientId: string) => appService.validateAuthorizeRequest({ clientId })
const notApproved = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'APP_NOT_APPROVED'

before(async () => {
  await fx.init()
  wasRequired = await appService.approvalRequired()
  await appService.setApprovalRequired(false, null)
})

after(async () => {
  await appService.setApprovalRequired(wasRequired, null)
  await fx.cleanup()
  if (apps.length) await db.delete(schema.apps).where(inArray(schema.apps.id, apps))
  await closeDb()
})

describe('app approval', () => {
  test('is off by default: any marketplace app can be installed', async () => {
    const app = await marketplaceApp('open')
    assert.equal(await appService.approvalRequired(), false)
    assert.ok(await inCatalog(app.id))
    await authorize(app.clientId)
    await install(app.id)
  })

  test('required: an unapproved marketplace app is hidden, and neither authorize nor install accept it', async () => {
    const app = await marketplaceApp('waiting')
    await appService.setApprovalRequired(true, null)
    assert.equal(await inCatalog(app.id), false)
    await assert.rejects(() => authorize(app.clientId), notApproved)
    await assert.rejects(() => install(app.id), notApproved)
  })

  test('approving it lets shops install it; taking it back stops new installs only', async () => {
    const app = await marketplaceApp('approved')
    await appService.setApprovalRequired(true, null)
    assert.equal((await appService.setApproval(app.id, true, null))?.approved, true)
    assert.ok(await inCatalog(app.id))
    const installation = await install(app.id)

    await appService.setApproval(app.id, false, null)
    const installed = await appService.listInstallations(SHOP)
    assert.ok(
      installed.some((i) => i.id === installation.id),
      'the installed app stays',
    )
    await appService.uninstall(SHOP, installation.id)
    await assert.rejects(() => install(app.id), notApproved)
  })

  test('custom apps never wait for approval', async () => {
    await appService.setApprovalRequired(true, null)
    const { app } = await appService.registerApp(
      { name: `E2E custom ${Date.now()}`, appUrl: 'http://127.0.0.1:9/app', redirectUrls: [], scopes: [...scopes] },
      null,
    )
    apps.push(app.id)
    assert.equal(app.approved, true)
    assert.ok(await inCatalog(app.id))
    await authorize(app.clientId)
  })

  test('turning it on approves the marketplace apps shops already run, and only those', async () => {
    await appService.setApprovalRequired(false, null)
    const running = await marketplaceApp('running')
    const idle = await marketplaceApp('idle')
    await install(running.id)
    await appService.setApprovalRequired(true, null)

    const { requireApproval, apps: list } = await appService.listMarketplaceApps()
    assert.equal(requireApproval, true)
    const byId = new Map(list.map((a) => [a.id, a]))
    assert.equal(byId.get(running.id)?.approved, true)
    assert.equal(byId.get(running.id)?.installs, 1)
    assert.equal(byId.get(idle.id)?.approved, false)
  })

  test('only marketplace apps can be approved or taken back', async () => {
    const { app } = await appService.registerApp(
      { name: `E2E custom2 ${Date.now()}`, appUrl: 'http://127.0.0.1:9/app', redirectUrls: [], scopes: [...scopes] },
      null,
    )
    apps.push(app.id)
    assert.equal(await appService.setApproval(app.id, false, null), null)
  })
})
