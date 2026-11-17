/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are whatever the capability sends; the tests read them loosely */
// What the ai tests share: the embedded database, and a fake AI app on localhost that records what ShopNex sends it and answers the
// way a test says. Importing this file picks the database, so it must come before anything imports @shopnex/db.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'
process.env.APP_URL = 'http://shop.test'

const { db, schema, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
const { pages } = await import('@shopnex/content/schema')
const { appInstallations } = await import('@shopnex/apps/schema')
requireEmbeddedDatabase()
const { eq, inArray } = await import('drizzle-orm')
const { aiGenerations, aiProviders, aiSettings } = await import('../src/ai.schema')

export { db, schema, prepareDatabase, aiGenerations, aiProviders, aiSettings }
export const SHOP = 'default'

// ── the fake AI app
export interface Received {
  path: string
  headers: Record<string, string | string[] | undefined>
  body: Record<string, any>
}
/** What the app answers to the next calls: a JSON body, or a failure */
export const behavior: { answer: unknown; status: number } = { answer: {}, status: 200 }
export const received: Received[] = []
let server: Server
export let appUrl = ''

export async function startFakeApp() {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      received.push({
        path: req.url ?? '',
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, any>,
      })
      res.writeHead(behavior.status, { 'content-type': 'application/json' }).end(JSON.stringify(behavior.answer))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  appUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
export const stopFakeApp = () => new Promise((resolve) => server.close(resolve))

export function answers(output: unknown, usage?: unknown) {
  behavior.status = 200
  behavior.answer = { output, ...(usage ? { usage } : {}) }
}
export function fails(status: number, body: unknown) {
  behavior.status = status
  behavior.answer = body
}
export function resetFakeApp() {
  behavior.status = 200
  behavior.answer = {}
  received.length = 0
}

// ── rows
let counter = 0
const unique = () => `${Date.now().toString(36)}${(++counter).toString(36)}`
const created = { apps: [] as string[], products: [] as string[], collections: [] as string[], pages: [] as string[] }

/** An app, installed in the shop (or not), that provides the capabilities it is given, each at `${appUrl}/run` */
export async function aiApp(opts: { name?: string; installed?: boolean; capabilities?: string[] } = {}) {
  const [app] = await db
    .insert(schema.apps)
    .values({
      name: opts.name ?? 'Fake AI',
      appUrl,
      redirectUrls: [],
      scopes: ['write_ai_capabilities'],
      clientId: `fake-ai-${unique()}`,
    })
    .returning()
  await db.insert(appInstallations).values({
    appId: app!.id,
    shopId: SHOP,
    scopes: ['write_ai_capabilities'],
    ...(opts.installed === false ? { uninstalledAt: new Date() } : {}),
  })
  for (const capability of opts.capabilities ?? [])
    await db.insert(aiProviders).values({ shopId: SHOP, appId: app!.id, capability, url: `${appUrl}/run` })
  created.apps.push(app!.id)
  return app!
}

export async function product(patch: Partial<typeof schema.products.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.products)
    .values({ shopId: SHOP, slug: `ai-${unique()}`, title: 'Linen shirt', priceCents: 2500, ...patch })
    .returning()
  created.products.push(row!.id)
  return row!
}

export async function collection(patch: Partial<typeof schema.collections.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.collections)
    .values({ shopId: SHOP, slug: `ai-${unique()}`, title: 'Summer', ...patch })
    .returning()
  created.collections.push(row!.id)
  return row!
}

export async function page(patch: Partial<typeof pages.$inferInsert> = {}) {
  const [row] = await db
    .insert(pages)
    .values({ shopId: SHOP, handle: `ai-${unique()}`, title: 'Shipping', bodyHtml: '<p>Ships in 2 days</p>', ...patch })
    .returning()
  created.pages.push(row!.id)
  return row!
}

/** Everything the tests made, and the generations and settings they left */
export async function cleanup() {
  await db.delete(aiGenerations).where(eq(aiGenerations.shopId, SHOP))
  await db.delete(aiSettings).where(eq(aiSettings.shopId, SHOP))
  if (created.apps.length) await db.delete(schema.apps).where(inArray(schema.apps.id, created.apps))
  if (created.products.length) await db.delete(schema.products).where(inArray(schema.products.id, created.products))
  if (created.collections.length)
    await db.delete(schema.collections).where(inArray(schema.collections.id, created.collections))
  if (created.pages.length) await db.delete(pages).where(inArray(pages.id, created.pages))
  for (const list of Object.values(created)) list.length = 0
}
