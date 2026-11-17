// What the apps tests share: the embedded database, apps registered the way a developer does it (with their private key, to sign client
// assertions), and a fake app on localhost that receives ShopNex's "installed" call. Importing this file picks the database, so it
// must come before anything imports @shopnex/db.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'
process.env.APP_URL = 'http://shop.test'

const { db, schema, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
requireEmbeddedDatabase()
const { eq, inArray } = await import('drizzle-orm')
const { appService } = await import('../src')
const { createClientAssertion } = await import('@shopnex/marketplace-sdk/keys')

export { db, schema, prepareDatabase, eq, appService }
export const SHOP = 'default'
/** The audience of a client assertion: this instance's public origin (APP_URL) */
export const AUDIENCE = 'http://shop.test'
export const REDIRECT = 'http://127.0.0.1/callback'

// ── a fake app that records what ShopNex sends it
export interface Received {
  path: string
  headers: Record<string, string | string[] | undefined>
  body: Record<string, unknown>
}
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
        body: JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>,
      })
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  appUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
// The installed call is not awaited by the install, so let the last ones land before the server goes away
export const stopFakeApp = async () => {
  await new Promise((r) => setTimeout(r, 400))
  await new Promise((resolve) => server.close(resolve))
}

// ── rows
let counter = 0
export const unique = () => `${Date.now().toString(36)}${(++counter).toString(36)}`
const made = { apps: [] as string[], users: [] as string[], shops: [] as string[] }

/** An app registered like a developer does: returns it with the private key that signs its client assertions */
export async function newApp(patch: Partial<Parameters<typeof appService.registerApp>[0]> = {}) {
  const { app, privateKey } = await appService.registerApp(
    {
      name: `App ${unique()}`,
      appUrl,
      redirectUrls: [REDIRECT],
      scopes: ['read_products', 'write_orders'],
      ...patch,
    },
    null,
  )
  made.apps.push(app.id)
  return { app, privateKey, assertion: () => createClientAssertion(privateKey, app.clientId, AUDIENCE) }
}

export async function user() {
  const id = `u-${unique()}`
  const [row] = await db
    .insert(schema.user)
    .values({ id, name: id, email: `${id}@example.test` })
    .returning()
  made.users.push(id)
  return row!
}

export async function shop() {
  const id = `s-${unique()}`
  const [row] = await db.insert(schema.shops).values({ id, name: id, slug: id }).returning()
  made.shops.push(id)
  return row!
}

/** Waits for a request the fake app should get (the callback is not awaited by the install) */
export async function until(predicate: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!predicate() && Date.now() < end) await new Promise((r) => setTimeout(r, 20))
  return predicate()
}

/** Everything the tests made (an app takes its installations, tokens, codes and data with it) */
export async function cleanup() {
  if (made.apps.length) await db.delete(schema.apps).where(inArray(schema.apps.id, made.apps))
  await db.delete(schema.shops).where(inArray(schema.shops.id, made.shops))
  await db.delete(schema.user).where(inArray(schema.user.id, made.users))
  for (const list of Object.values(made)) list.length = 0
  received.length = 0
}
