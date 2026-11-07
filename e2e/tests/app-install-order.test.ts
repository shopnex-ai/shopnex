// A marketplace app asks the marketplace "is this install real?" before it trusts an instance, and the marketplace
// only knows what the instance reports. So the instance reports first and only then tells the app (and lets the
// merchant in); otherwise the app's first check races the report and fails with "no record of this install".
// Uses fake servers for the marketplace and the app, and its own apps (deleted at the end). Skipped when this
// database has a real marketplace connection: the test would have to replace it.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import { appService, marketplaceService } from '@shopnex/apps'
import { db, schema } from '@shopnex/db'
import { SHOP, closeDb } from '../lib'

const busy = Boolean(await marketplaceService.getConnection())

const events: string[] = []
const reports: { appId: string; shopId: string }[][] = []
const apps: string[] = []
let marketplace: Server
let app: Server
let marketplaceUrl: string
let appUrl: string

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  )

before(async () => {
  if (busy) return
  marketplace = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    if (req.method === 'PUT' && req.url === '/api/v1/instance/installations') {
      events.push('report-received')
      reports.push(JSON.parse(body).installations)
      // A slow marketplace: the app must not be told until it has answered
      await new Promise((r) => setTimeout(r, 200))
      events.push('report-done')
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
  })
  app = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/shopnex/installed') events.push('notified')
    res.writeHead(204).end()
  })
  marketplaceUrl = await listen(marketplace)
  appUrl = await listen(app)
  await db.insert(schema.marketplaceConnection).values({
    id: 'default',
    marketplaceUrl,
    publicUrl: 'http://127.0.0.1:3000',
    instanceKey: 'mk_e2e',
    connectedAt: new Date(),
  })
})

after(async () => {
  if (!busy) {
    await db.delete(schema.marketplaceConnection).where(eq(schema.marketplaceConnection.id, 'default'))
    if (apps.length) await db.delete(schema.apps).where(inArray(schema.apps.id, apps))
    marketplace?.close()
    app?.close()
  }
  await closeDb()
})

async function marketplaceApp() {
  const [row] = await db
    .insert(schema.apps)
    .values({
      source: 'marketplace',
      marketplaceAppId: randomUUID(),
      name: `E2E order ${Date.now()}`,
      appUrl,
      redirectUrls: [],
      scopes: ['read_orders'],
      clientId: `app_e2e_${randomUUID()}`,
    })
    .returning()
  apps.push(row!.id)
  return row!
}

const install = (appId: string) =>
  appService.installManaged({ appId, shopId: SHOP, userId: null as never, scopes: ['read_orders'] })

async function notified() {
  for (let i = 0; i < 60 && !events.includes('notified'); i++) await new Promise((r) => setTimeout(r, 50))
  assert.ok(events.includes('notified'), 'the app was told about the install')
}

describe('install order', { skip: busy && 'this database has a real marketplace connection' }, () => {
  test('a marketplace app install is reported to the marketplace before the app is told', async () => {
    events.length = 0
    reports.length = 0
    const row = await marketplaceApp()
    const installation = await install(row.id)
    assert.ok(events.includes('report-done'), 'the install waited for the marketplace to take the report')
    await notified()
    assert.deepEqual(events, ['report-received', 'report-done', 'notified'])
    const sent = reports.at(-1)!
    assert.ok(sent.some((i) => i.appId === row.marketplaceAppId && i.shopId === installation.shopId))
  })

  test('a marketplace that is down does not stop the install or the notification', async () => {
    events.length = 0
    const row = await marketplaceApp()
    await db
      .update(schema.marketplaceConnection)
      .set({ marketplaceUrl: 'http://127.0.0.1:9' })
      .where(eq(schema.marketplaceConnection.id, 'default'))
    try {
      const silence = console.error
      console.error = () => {}
      try {
        await install(row.id)
        await notified()
      } finally {
        console.error = silence
      }
      assert.ok(!events.includes('report-received'))
    } finally {
      await db
        .update(schema.marketplaceConnection)
        .set({ marketplaceUrl })
        .where(eq(schema.marketplaceConnection.id, 'default'))
    }
  })

  test('a custom app is not reported to the marketplace', async () => {
    events.length = 0
    const { app: custom } = await appService.registerApp(
      { name: `E2E custom order ${Date.now()}`, appUrl, redirectUrls: [], scopes: ['read_orders'] },
      null,
    )
    apps.push(custom.id)
    await install(custom.id)
    await notified()
    assert.deepEqual(events, ['notified'])
  })
})
