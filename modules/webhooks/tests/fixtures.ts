// What the webhooks tests share: the embedded database, and a fake receiver on localhost that records what ShopNex sends and answers
// the way a test says. Importing this file picks the database, so it must come before anything imports @shopnex/db.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

process.env.DATABASE_URL = 'pglite:memory'
process.env.SHOPNEX_SECRET = 'test-secret-test-secret-test-secret-0123'

const { db, schema, prepareDatabase, requireEmbeddedDatabase } = await import('@shopnex/db')
requireEmbeddedDatabase()
const { eq, inArray } = await import('drizzle-orm')
const { generateSecret } = await import('../src/sign')

export { db, schema, prepareDatabase }
export const SHOP = 'default'
export const OTHER_SHOP = 'webhooks-other-shop'

// ── the fake receiver
export interface Received {
  path: string
  headers: Record<string, string | string[] | undefined>
  body: string
}
export const behavior = { status: 200, body: 'ok', location: '' }
export const received: Received[] = []
let server: Server
export let receiverUrl = ''

export async function startReceiver() {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      received.push({ path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString() })
      res.writeHead(behavior.status, behavior.location ? { location: behavior.location } : {}).end(behavior.body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  receiverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
export const stopReceiver = () => new Promise((resolve) => server.close(resolve))
export function resetReceiver() {
  behavior.status = 200
  behavior.body = 'ok'
  behavior.location = ''
  received.length = 0
}

// ── rows
const created = { endpoints: [] as string[], tokens: [] as string[] }
let counter = 0
const unique = () => `${Date.now().toString(36)}${(++counter).toString(36)}`

export async function otherShop() {
  await db
    .insert(schema.shops)
    .values({ id: OTHER_SHOP, name: 'Other shop', slug: `other-${unique()}` })
    .onConflictDoNothing()
}

export async function endpoint(patch: Partial<typeof schema.webhookEndpoints.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.webhookEndpoints)
    .values({
      shopId: SHOP,
      url: `${receiverUrl}/hook`,
      topics: ['order.created'],
      secret: generateSecret(),
      ...patch,
    })
    .returning()
  created.endpoints.push(row!.id)
  return row!
}

export async function apiToken(opts: { name?: string; appId?: string } = {}) {
  const [row] = await db
    .insert(schema.apiTokens)
    .values({
      shopId: SHOP,
      name: opts.name ?? 'Test token',
      scopes: [],
      tokenHash: `hash-${unique()}`,
      tokenPrefix: 'sk_test',
      appId: opts.appId ?? null,
    })
    .returning()
  created.tokens.push(row!.id)
  return row!
}

export async function delivery(endpointId: string, patch: Partial<typeof schema.webhookDeliveries.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.webhookDeliveries)
    .values({
      shopId: SHOP,
      endpointId,
      topic: 'order.created',
      body: JSON.stringify({ type: 'order.created', data: { id: 'o1' } }),
      ...patch,
    })
    .returning()
  return row!
}

export const deliveriesOf = (endpointId: string) =>
  db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.endpointId, endpointId))
export const deliveryById = async (id: string) =>
  (await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.id, id)))[0]

/** Everything the tests made (deliveries go with their endpoints) */
export async function cleanup() {
  if (created.endpoints.length)
    await db.delete(schema.webhookEndpoints).where(inArray(schema.webhookEndpoints.id, created.endpoints))
  if (created.tokens.length) await db.delete(schema.apiTokens).where(inArray(schema.apiTokens.id, created.tokens))
  // Created by the services under test, not through the helpers
  await db.delete(schema.webhookEndpoints).where(inArray(schema.webhookEndpoints.shopId, [SHOP, OTHER_SHOP]))
  created.endpoints.length = 0
  created.tokens.length = 0
}
